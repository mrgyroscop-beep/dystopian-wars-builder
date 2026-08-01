import { readFile } from "node:fs/promises";
import path from "node:path";
import { CatalogImportError } from "./errors.mjs";

const sha1 = /^[0-9a-f]{40}$/u;
const sha256 = /^[0-9a-f]{64}$/u;
const sourcePath = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._ /()-]+\.(?:gst|cat)$/u;

export async function readSourceLock(lockPath) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8"));
  } catch (error) {
    throw new CatalogImportError("SOURCE_LOCK_READ", "Cannot read the catalog source lock", {
      lockPath: path.basename(lockPath),
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return validateSourceLock(parsed);
}

export function validateSourceLock(lock) {
  if (!lock || typeof lock !== "object" || Array.isArray(lock)) invalid("lock must be an object");
  if (lock.repository !== "Nord0rk/Dystopian-Wars-4.0") invalid("repository is not allowlisted");
  assertExactKeys(lock, ["repository", "commit", "tree", "files"], "source lock");
  if (!sha1.test(lock.commit ?? "") || !sha1.test(lock.tree ?? ""))
    invalid("commit/tree must be full SHAs");
  if (!Array.isArray(lock.files) || lock.files.length !== 10)
    invalid("exactly ten source files are required");

  const seen = new Set();
  for (const file of lock.files) {
    if (!file || typeof file !== "object" || !sourcePath.test(file.path ?? ""))
      invalid("unsafe source path");
    assertExactKeys(file, ["path", "blob", "sha256"], `source entry: ${file.path ?? "unknown"}`);
    if (seen.has(file.path)) invalid(`duplicate source path: ${file.path}`);
    seen.add(file.path);
    if (!sha1.test(file.blob ?? "") || !sha256.test(file.sha256 ?? ""))
      invalid(`invalid hashes: ${file.path}`);
  }
  if (![...seen].some((name) => name.endsWith(".gst"))) invalid("game system source is missing");
  return Object.freeze({
    ...lock,
    files: Object.freeze([...lock.files].sort((a, b) => a.path.localeCompare(b.path))),
  });
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  if (actual.join("\0") !== [...expected].sort().join("\0"))
    invalid(`${label} has unexpected fields`);
}

function invalid(reason) {
  throw new CatalogImportError("SOURCE_LOCK_INVALID", "Catalog source lock is invalid", { reason });
}
