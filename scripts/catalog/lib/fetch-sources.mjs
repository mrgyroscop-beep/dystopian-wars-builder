import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { CatalogImportError } from "./errors.mjs";

const RAW_ORIGIN = "https://raw.githubusercontent.com";
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

export async function fetchLockedSources(lock, cacheRoot, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const destination = path.join(cacheRoot, "sources", lock.commit);
  await mkdir(destination, { recursive: true });
  const results = [];
  let totalBytes = 0;

  // Deliberately sequential: bounded memory, predictable upstream load and diagnostics.
  for (const source of lock.files) {
    const file = path.join(destination, safeCacheName(source.path));
    const cached = await readVerified(file, source.sha256);
    if (cached) {
      if (cached.byteLength !== source.bytes)
        throw new CatalogImportError(
          "SOURCE_SIZE_MISMATCH",
          "Cached source size differs from lock",
          {
            path: source.path,
            expected: source.bytes,
            actual: cached.byteLength,
          },
        );
      totalBytes += cached.byteLength;
      if (totalBytes > MAX_TOTAL_BYTES) throw limitError("source set", MAX_TOTAL_BYTES);
      results.push({ ...source, file, bytes: cached.byteLength, cache: "hit" });
      continue;
    }

    const bytes = await downloadSource(lock, source, fetchImpl);
    if (bytes.byteLength !== source.bytes)
      throw new CatalogImportError(
        "SOURCE_SIZE_MISMATCH",
        "Downloaded source size differs from lock",
        {
          path: source.path,
          expected: source.bytes,
          actual: bytes.byteLength,
        },
      );
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) throw limitError("source set", MAX_TOTAL_BYTES);
    await atomicWrite(file, bytes);
    results.push({ ...source, file, bytes: bytes.byteLength, cache: "miss" });
  }
  return results;
}

export async function verifyCachedSources(lock, cacheRoot) {
  const destination = path.join(cacheRoot, "sources", lock.commit);
  const results = [];
  for (const source of lock.files) {
    const file = path.join(destination, safeCacheName(source.path));
    const bytes = await readVerified(file, source.sha256);
    if (!bytes) {
      throw new CatalogImportError("CACHE_MISS", "A verified locked source is not available", {
        path: source.path,
      });
    }
    results.push({ ...source, file, bytes: bytes.byteLength, cache: "hit" });
  }
  return results;
}

async function downloadSource(lock, source, fetchImpl) {
  const url = new URL(
    `/${encodeURIComponent(lock.repository.split("/")[0])}/${encodeURIComponent(lock.repository.split("/")[1])}/${lock.commit}/${source.path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`,
    RAW_ORIGIN,
  );
  assertAllowedUrl(url, lock, source);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "application/octet-stream",
        "user-agent": "dystopian-wars-builder-catalog-import",
      },
    });
  } catch (error) {
    clearTimeout(timer);
    throw new CatalogImportError(
      "NETWORK_FAILURE",
      "Locked catalog source could not be downloaded",
      {
        path: source.path,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
  if (!response.ok) {
    clearTimeout(timer);
    throw new CatalogImportError(
      "SOURCE_HTTP",
      "Locked catalog source returned an unexpected response",
      {
        path: source.path,
        status: response.status,
      },
    );
  }
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
    clearTimeout(timer);
    throw limitError(source.path, MAX_FILE_BYTES);
  }
  if (!response.body) {
    clearTimeout(timer);
    throw new CatalogImportError("SOURCE_EMPTY", "Locked catalog response has no body", {
      path: source.path,
    });
  }

  const chunks = [];
  let length = 0;
  try {
    for await (const chunk of response.body) {
      const bytes = Buffer.from(chunk);
      length += bytes.byteLength;
      if (length > MAX_FILE_BYTES) throw limitError(source.path, MAX_FILE_BYTES);
      chunks.push(bytes);
    }
  } catch (error) {
    if (error instanceof CatalogImportError) throw error;
    throw new CatalogImportError(
      "NETWORK_FAILURE",
      "Locked catalog source body could not be downloaded",
      {
        path: source.path,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  } finally {
    clearTimeout(timer);
  }
  const result = Buffer.concat(chunks);
  const actual = digest(result);
  if (actual !== source.sha256) {
    throw new CatalogImportError(
      "SOURCE_HASH_MISMATCH",
      "Locked catalog source failed integrity verification",
      {
        path: source.path,
        expected: source.sha256,
        actual,
      },
    );
  }
  return result;
}

function assertAllowedUrl(url, lock, source) {
  const exact = `/${lock.repository}/${lock.commit}/${source.path}`;
  if (
    url.origin !== RAW_ORIGIN ||
    decodeURIComponent(url.pathname) !== exact ||
    !lock.files.some((file) => file.path === source.path)
  ) {
    throw new CatalogImportError("SOURCE_URL_REJECTED", "Catalog source URL is not allowlisted", {
      path: source.path,
    });
  }
}

async function readVerified(file, expected) {
  try {
    const bytes = await readFile(file);
    if (bytes.byteLength > MAX_FILE_BYTES || digest(bytes) !== expected) {
      await rm(file, { force: true });
      return undefined;
    }
    return bytes;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function atomicWrite(file, bytes) {
  const temporary = `${file}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}

function safeCacheName(sourcePath) {
  return `${createHash("sha256").update(sourcePath).digest("hex").slice(0, 16)}-${path.basename(sourcePath)}`;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function limitError(pathLabel, limit) {
  return new CatalogImportError(
    "SOURCE_SIZE_LIMIT",
    "Locked catalog source exceeds the configured byte limit",
    {
      path: pathLabel,
      limit,
    },
  );
}
