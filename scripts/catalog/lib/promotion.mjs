import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "./canonical.mjs";
import { CatalogImportError, redact } from "./errors.mjs";

export async function promoteDataset(dataset, runtimeRoot, options = {}) {
  return withPromotionLock(runtimeRoot, async () => {
    const before = await readCurrent(runtimeRoot);
    const expected = Object.hasOwn(options, "expectedCurrent")
      ? options.expectedCurrent
      : (before?.releaseId ?? null);
    if ((before?.releaseId ?? null) !== expected) {
      throw new CatalogImportError(
        "PROMOTION_CAS_MISMATCH",
        "Current catalog changed before promotion",
        {
          expected,
          actual: before?.releaseId ?? null,
        },
      );
    }
    const releases = path.join(runtimeRoot, "releases");
    await mkdir(releases, { recursive: true });
    const release = path.join(releases, dataset.releaseId);
    if (!(await exists(release))) {
      const staging = path.join(runtimeRoot, `.staging-${dataset.releaseId}-${randomUUID()}`);
      await mkdir(staging, { recursive: false });
      try {
        for (const [name, contents] of dataset.files)
          await durableWrite(path.join(staging, name), contents);
        await verifyRelease(staging, dataset.releaseId);
        await rename(staging, release);
      } catch (error) {
        await rm(staging, { recursive: true, force: true });
        throw error;
      }
    } else {
      await verifyRelease(release, dataset.releaseId);
    }
    await writePointer(runtimeRoot, { releaseId: dataset.releaseId });
    await writeOperational(runtimeRoot, {
      lastAttempt: options.attemptedAt ?? new Date().toISOString(),
      result: "success",
      releaseId: dataset.releaseId,
      previousReleaseId: before?.releaseId ?? null,
    });
    return { releaseId: dataset.releaseId, previousReleaseId: before?.releaseId ?? null };
  });
}

export async function rollbackDataset(runtimeRoot, releaseId, options = {}) {
  return withPromotionLock(runtimeRoot, async () => {
    const before = await readCurrent(runtimeRoot);
    const expected = Object.hasOwn(options, "expectedCurrent")
      ? options.expectedCurrent
      : (before?.releaseId ?? null);
    if ((before?.releaseId ?? null) !== expected) {
      throw new CatalogImportError(
        "PROMOTION_CAS_MISMATCH",
        "Current catalog changed before rollback",
        {
          expected,
          actual: before?.releaseId ?? null,
        },
      );
    }
    const release = path.join(runtimeRoot, "releases", releaseId);
    await verifyRelease(release, releaseId);
    await writePointer(runtimeRoot, { releaseId });
    await writeOperational(runtimeRoot, {
      lastAttempt: options.attemptedAt ?? new Date().toISOString(),
      result: "rollback",
      releaseId,
      previousReleaseId: before?.releaseId ?? null,
    });
    return { releaseId, previousReleaseId: before?.releaseId ?? null };
  });
}

export async function recordOperationalFailure(
  runtimeRoot,
  error,
  attemptedAt = new Date().toISOString(),
) {
  await mkdir(runtimeRoot, { recursive: true });
  const current = await readCurrent(runtimeRoot);
  await writeOperational(runtimeRoot, {
    lastAttempt: attemptedAt,
    result: "failure",
    releaseId: current?.releaseId ?? null,
    error: redact({
      code: error && typeof error === "object" && "code" in error ? error.code : "UNEXPECTED",
      message: error instanceof Error ? error.message : String(error),
      details: error && typeof error === "object" && "details" in error ? error.details : {},
    }),
  });
}

export async function readCurrent(runtimeRoot) {
  try {
    const value = JSON.parse(await readFile(path.join(runtimeRoot, "current.json"), "utf8"));
    if (!/^[0-9a-f]{64}$/u.test(value.releaseId ?? "")) throw new Error("invalid release id");
    return value;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return undefined;
    throw new CatalogImportError("CURRENT_POINTER_INVALID", "Current catalog pointer is invalid", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function verifyRelease(directory, releaseId) {
  let manifestText;
  try {
    manifestText = await readFile(path.join(directory, "manifest.json"), "utf8");
    if (sha256(manifestText) !== releaseId)
      throw new Error("manifest hash does not match release id");
    const manifest = JSON.parse(manifestText);
    const graph = await readFile(path.join(directory, manifest.graph.file));
    if (graph.byteLength !== manifest.graph.bytes || sha256(graph) !== manifest.graph.sha256)
      throw new Error("graph integrity mismatch");
  } catch (error) {
    throw new CatalogImportError(
      "RELEASE_INVALID",
      "Catalog release failed integrity verification",
      {
        releaseId,
        reason: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

async function withPromotionLock(runtimeRoot, operation) {
  await mkdir(runtimeRoot, { recursive: true });
  const lock = path.join(runtimeRoot, ".promotion-lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      throw new CatalogImportError(
        "PROMOTION_LOCKED",
        "Another catalog promotion is in progress",
        {},
      );
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    await rm(lock, { recursive: true, force: true });
  }
}

async function writePointer(runtimeRoot, pointer) {
  const temporary = path.join(runtimeRoot, `current.${randomUUID()}.tmp`);
  await durableWrite(temporary, canonicalJson(pointer));
  await rename(temporary, path.join(runtimeRoot, "current.json"));
}

async function writeOperational(runtimeRoot, value) {
  const temporary = path.join(runtimeRoot, `operational.${randomUUID()}.tmp`);
  await durableWrite(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, path.join(runtimeRoot, "operational.json"));
}

async function durableWrite(file, contents) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}
