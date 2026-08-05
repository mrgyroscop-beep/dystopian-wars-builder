import { CatalogImportError } from "./errors.mjs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonicalJson } from "./canonical.mjs";

const API_ORIGIN = "https://api.github.com";
const MAX_API_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

export async function verifyLockedProvenance(lock, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const [owner, repository] = lock.repository.split("/");
  const commitUrl = new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/commits/${lock.commit}`,
    API_ORIGIN,
  );
  const commit = await fetchJson(commitUrl, fetchImpl, options.githubToken);
  if (
    commit.sha !== lock.commit ||
    commit.tree?.sha !== lock.tree ||
    commit.committer?.date !== lock.commitTimestamp
  ) {
    throw new CatalogImportError(
      "PROVENANCE_COMMIT_MISMATCH",
      "GitHub commit provenance does not match the source lock",
      {
        expectedCommit: lock.commit,
        actualCommit: commit.sha,
        expectedTree: lock.tree,
        actualTree: commit.tree?.sha,
        expectedTimestamp: lock.commitTimestamp,
        actualTimestamp: commit.committer?.date,
      },
    );
  }

  const treeUrl = new URL(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${lock.tree}?recursive=1`,
    API_ORIGIN,
  );
  const tree = await fetchJson(treeUrl, fetchImpl, options.githubToken);
  if (tree.sha !== lock.tree || tree.truncated === true || !Array.isArray(tree.tree)) {
    throw new CatalogImportError(
      "PROVENANCE_TREE_MISMATCH",
      "GitHub tree provenance does not match the source lock",
      { expectedTree: lock.tree, actualTree: tree.sha, truncated: tree.truncated },
    );
  }
  const catalogEntries = tree.tree
    .filter((entry) => typeof entry.path === "string" && /\.(?:cat|gst)$/u.test(entry.path))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (catalogEntries.length !== lock.files.length) {
    throw new CatalogImportError(
      "PROVENANCE_INVENTORY_MISMATCH",
      "GitHub tree catalog inventory does not match the source lock",
      { expected: lock.files.length, actual: catalogEntries.length },
    );
  }
  for (const [index, locked] of lock.files.entries()) {
    const resolved = catalogEntries[index];
    if (
      resolved?.path !== locked.path ||
      resolved.type !== "blob" ||
      resolved.sha !== locked.blob ||
      resolved.size !== locked.bytes
    ) {
      throw new CatalogImportError(
        "PROVENANCE_BLOB_MISMATCH",
        "GitHub blob provenance does not match the source lock",
        {
          path: locked.path,
          expectedBlob: locked.blob,
          actualBlob: resolved?.sha,
          expectedBytes: locked.bytes,
          actualBytes: resolved?.size,
        },
      );
    }
  }
  return Object.freeze({
    repository: lock.repository,
    commit: commit.sha,
    tree: tree.sha,
    commitTimestamp: commit.committer.date,
    files: Object.freeze(
      catalogEntries.map((entry) =>
        Object.freeze({ path: entry.path, blob: entry.sha, bytes: entry.size }),
      ),
    ),
  });
}

export async function verifyAndCacheLockedProvenance(lock, cacheRoot, options = {}) {
  const provenance = await verifyLockedProvenance(lock, options);
  const directory = path.join(cacheRoot, "provenance");
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${lock.commit}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, canonicalJson(provenance), { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
  return provenance;
}

export async function readCachedProvenance(lock, cacheRoot) {
  try {
    return JSON.parse(
      await readFile(path.join(cacheRoot, "provenance", `${lock.commit}.json`), "utf8"),
    );
  } catch (error) {
    throw new CatalogImportError(
      "PROVENANCE_CACHE_MISS",
      "Verified GitHub provenance is not available in cache",
      { reason: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function fetchJson(url, fetchImpl, githubToken) {
  if (
    url.origin !== API_ORIGIN ||
    !url.pathname.startsWith("/repos/Nord0rk/Dystopian-Wars-4.0/git/")
  ) {
    throw new CatalogImportError(
      "PROVENANCE_URL_REJECTED",
      "GitHub provenance URL is not allowlisted",
      {},
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "dystopian-wars-builder-catalog-import",
        ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
      },
    });
    if (!response.ok)
      throw new CatalogImportError("PROVENANCE_HTTP", "GitHub provenance request failed", {
        endpoint: url.pathname.split("/").at(-2),
        status: response.status,
      });
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_API_BYTES)
      throw new CatalogImportError(
        "PROVENANCE_SIZE_LIMIT",
        "GitHub provenance response is too large",
        {},
      );
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_API_BYTES)
      throw new CatalogImportError(
        "PROVENANCE_SIZE_LIMIT",
        "GitHub provenance response is too large",
        {},
      );
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof CatalogImportError) throw error;
    throw new CatalogImportError("PROVENANCE_FAILURE", "GitHub provenance could not be verified", {
      reason: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}
