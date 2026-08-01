import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "./canonical.mjs";
import { CatalogImportError, redact } from "./errors.mjs";

export async function promoteDataset(dataset, runtimeRoot, options = {}) {
  return withPromotionLock(
    runtimeRoot,
    async () => {
      const before = await readLifecycle(runtimeRoot);
      assertExpected(before, options, "promotion");
      assertReleaseId(dataset.releaseId, "candidate release");
      const release = await prepareRelease(dataset, runtimeRoot);
      await inject(options, "after-release");

      const operationId = randomUUID();
      const requestedReleaseId = options.requestedReleaseId ?? dataset.releaseId;
      assertReleaseId(requestedReleaseId, "requested release");
      const previousActive = before?.activeReleaseId ?? null;
      const operation = {
        schemaVersion: 1,
        operationId,
        action: "PROMOTE",
        state: "RESOLVED",
        attemptedAt: options.attemptedAt ?? new Date().toISOString(),
        requestedReleaseId,
        resolvedReleaseId: dataset.releaseId,
        activeReleaseId: previousActive,
        lastKnownGoodReleaseId: before?.lastKnownGoodReleaseId ?? previousActive,
        diagnosticId: null,
      };
      await writeOperation(runtimeRoot, operation);
      await inject(options, "after-operation");
      await verifyRelease(release, dataset.releaseId);
      await inject(options, "before-lifecycle");

      const lifecycle = {
        schemaVersion: 1,
        state: "ACTIVE",
        operationId,
        requestedReleaseId,
        resolvedReleaseId: dataset.releaseId,
        activeReleaseId: dataset.releaseId,
        lastKnownGoodReleaseId: previousActive,
      };
      // This is the commit point and the final fallible operation. Callers cannot
      // observe a thrown promotion after the candidate becomes authoritative.
      await writeJsonAtomic(path.join(runtimeRoot, "lifecycle.json"), lifecycle);
      return lifecycle;
    },
    options,
  );
}

export async function rollbackDataset(runtimeRoot, releaseId, options = {}) {
  return withPromotionLock(
    runtimeRoot,
    async () => {
      const before = await readLifecycle(runtimeRoot);
      assertExpected(before, options, "rollback");
      assertReleaseId(releaseId, "rollback release");
      const release = path.join(runtimeRoot, "releases", releaseId);
      await verifyRelease(release, releaseId);
      await inject(options, "after-release");

      const operationId = randomUUID();
      const previousActive = before?.activeReleaseId ?? null;
      const operation = {
        schemaVersion: 1,
        operationId,
        action: "ROLLBACK",
        state: "RESOLVED",
        attemptedAt: options.attemptedAt ?? new Date().toISOString(),
        requestedReleaseId: releaseId,
        resolvedReleaseId: releaseId,
        activeReleaseId: previousActive,
        lastKnownGoodReleaseId: before?.lastKnownGoodReleaseId ?? previousActive,
        diagnosticId: null,
      };
      await writeOperation(runtimeRoot, operation);
      await inject(options, "after-operation");
      await inject(options, "before-lifecycle");
      const lifecycle = {
        schemaVersion: 1,
        state: "ACTIVE",
        operationId,
        requestedReleaseId: releaseId,
        resolvedReleaseId: releaseId,
        activeReleaseId: releaseId,
        lastKnownGoodReleaseId: previousActive,
      };
      await writeJsonAtomic(path.join(runtimeRoot, "lifecycle.json"), lifecycle);
      return lifecycle;
    },
    options,
  );
}

export async function recordOperationalFailure(runtimeRoot, error, options = {}) {
  if (typeof options === "string") options = { attemptedAt: options };
  await mkdir(runtimeRoot, { recursive: true });
  const lifecycle = await readLifecycle(runtimeRoot);
  const diagnosticId = randomUUID();
  const diagnostic = redact({
    schemaVersion: 1,
    diagnosticId,
    code: error && typeof error === "object" && "code" in error ? error.code : "UNEXPECTED",
    message: error instanceof Error ? error.message : String(error),
    details: error && typeof error === "object" && "details" in error ? error.details : {},
  });
  await mkdir(path.join(runtimeRoot, "diagnostics"), { recursive: true });
  await writeJsonAtomic(path.join(runtimeRoot, "diagnostics", `${diagnosticId}.json`), diagnostic);
  const operationId = randomUUID();
  const operation = {
    schemaVersion: 1,
    operationId,
    action: options.action ?? "PROMOTE",
    state: "FAILED",
    attemptedAt: options.attemptedAt ?? new Date().toISOString(),
    requestedReleaseId: options.requestedReleaseId ?? null,
    resolvedReleaseId: options.resolvedReleaseId ?? null,
    activeReleaseId: lifecycle?.activeReleaseId ?? null,
    lastKnownGoodReleaseId: lifecycle?.lastKnownGoodReleaseId ?? null,
    diagnosticId,
  };
  await writeOperation(runtimeRoot, operation);
  return { operationId, diagnosticId };
}

export async function readLifecycle(runtimeRoot) {
  try {
    const value = JSON.parse(await readFile(path.join(runtimeRoot, "lifecycle.json"), "utf8"));
    for (const key of ["requestedReleaseId", "resolvedReleaseId", "activeReleaseId"])
      if (!isReleaseId(value[key])) throw new Error(`${key} is invalid`);
    if (value.lastKnownGoodReleaseId !== null && !isReleaseId(value.lastKnownGoodReleaseId))
      throw new Error("lastKnownGoodReleaseId is invalid");
    if (
      value.schemaVersion !== 1 ||
      value.state !== "ACTIVE" ||
      typeof value.operationId !== "string"
    )
      throw new Error("lifecycle schema/state is invalid");
    return value;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return undefined;
    throw new CatalogImportError("LIFECYCLE_INVALID", "Catalog lifecycle record is invalid", {
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function readCurrent(runtimeRoot) {
  const lifecycle = await readLifecycle(runtimeRoot);
  return lifecycle ? { releaseId: lifecycle.activeReleaseId } : undefined;
}

export async function verifyRelease(directory, releaseId) {
  try {
    const manifestText = await readFile(path.join(directory, "manifest.json"), "utf8");
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
      { releaseId, reason: error instanceof Error ? error.message : String(error) },
    );
  }
}

async function prepareRelease(dataset, runtimeRoot) {
  const releases = path.join(runtimeRoot, "releases");
  await mkdir(releases, { recursive: true });
  const release = path.join(releases, dataset.releaseId);
  if (await exists(release)) {
    await verifyRelease(release, dataset.releaseId);
    return release;
  }
  const staging = path.join(runtimeRoot, `.staging-${dataset.releaseId}-${randomUUID()}`);
  await mkdir(staging, { recursive: false });
  try {
    for (const [name, contents] of dataset.files)
      await durableWrite(path.join(staging, name), contents);
    await verifyRelease(staging, dataset.releaseId);
    await rename(staging, release);
    return release;
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

function assertExpected(before, options, action) {
  const expected = Object.hasOwn(options, "expectedCurrent")
    ? options.expectedCurrent
    : (before?.activeReleaseId ?? null);
  if ((before?.activeReleaseId ?? null) !== expected)
    throw new CatalogImportError(
      "PROMOTION_CAS_MISMATCH",
      `Current catalog changed before ${action}`,
      { expected, actual: before?.activeReleaseId ?? null },
    );
}

async function writeOperation(runtimeRoot, operation) {
  await mkdir(path.join(runtimeRoot, "operations"), { recursive: true });
  await writeJsonAtomic(
    path.join(runtimeRoot, "operations", `${operation.operationId}.json`),
    operation,
  );
}

async function withPromotionLock(runtimeRoot, operation, options) {
  await mkdir(runtimeRoot, { recursive: true });
  const lock = path.join(runtimeRoot, ".promotion-lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST")
      throw new CatalogImportError(
        "PROMOTION_LOCKED",
        "Another catalog promotion is in progress",
        {},
      );
    throw error;
  }
  try {
    return await operation();
  } finally {
    // Lock cleanup is deliberately best-effort: no cleanup error may turn a
    // committed lifecycle transition into a reported failed promotion.
    await (
      options.cleanupLock ? options.cleanupLock(lock) : rm(lock, { recursive: true, force: true })
    ).catch(() => undefined);
  }
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await durableWrite(temporary, canonicalJson(value));
  await rename(temporary, file);
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

async function inject(options, point) {
  if (options.fault) await options.fault(point);
}

function isReleaseId(value) {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

function assertReleaseId(value, label) {
  if (!isReleaseId(value))
    throw new CatalogImportError("RELEASE_ID_INVALID", `${label} hash is invalid`, {});
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
