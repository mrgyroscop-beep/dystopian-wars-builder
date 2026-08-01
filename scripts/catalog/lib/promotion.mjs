import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { canonicalJson, sha256 } from "./canonical.mjs";
import { compareCatalogVersions } from "./catalog-version.mjs";
import { CatalogImportError } from "./errors.mjs";

const diagnosticRules = Object.freeze({
  NETWORK_FAILURE: ["CATALOG_NETWORK_UNAVAILABLE", "warning", "NETWORK_UNAVAILABLE", "RETRY", true],
  SOURCE_HTTP: ["CATALOG_NETWORK_UNAVAILABLE", "warning", "NETWORK_UNAVAILABLE", "RETRY", true],
  PROVENANCE_FAILURE: ["CATALOG_SOURCE_UNVERIFIED", "error", "SOURCE_UNVERIFIED", "RETRY", true],
  PROVENANCE_HTTP: ["CATALOG_SOURCE_UNVERIFIED", "error", "SOURCE_UNVERIFIED", "RETRY", true],
  PROVENANCE_COMMIT_MISMATCH: [
    "CATALOG_SOURCE_UNVERIFIED",
    "error",
    "SOURCE_UNVERIFIED",
    "WAIT_FOR_SOURCE",
    false,
  ],
  PROVENANCE_TREE_MISMATCH: [
    "CATALOG_SOURCE_UNVERIFIED",
    "error",
    "SOURCE_UNVERIFIED",
    "WAIT_FOR_SOURCE",
    false,
  ],
  PROVENANCE_BLOB_MISMATCH: [
    "CATALOG_SOURCE_UNVERIFIED",
    "error",
    "SOURCE_UNVERIFIED",
    "WAIT_FOR_SOURCE",
    false,
  ],
  SOURCE_HASH_MISMATCH: [
    "CATALOG_SOURCE_UNVERIFIED",
    "error",
    "SOURCE_UNVERIFIED",
    "WAIT_FOR_SOURCE",
    false,
  ],
  XML_INVALID: ["CATALOG_SOURCE_INVALID", "error", "SOURCE_INVALID", "WAIT_FOR_SOURCE", false],
  LINK_TARGET_KIND: ["CATALOG_SOURCE_INVALID", "error", "SOURCE_INVALID", "WAIT_FOR_SOURCE", false],
  LINK_TYPE_INVALID: [
    "CATALOG_SOURCE_INVALID",
    "error",
    "SOURCE_INVALID",
    "WAIT_FOR_SOURCE",
    false,
  ],
  TARGET_UNRESOLVED: [
    "CATALOG_SOURCE_INVALID",
    "error",
    "SOURCE_INVALID",
    "WAIT_FOR_SOURCE",
    false,
  ],
  TARGET_AMBIGUOUS: ["CATALOG_SOURCE_INVALID", "error", "SOURCE_INVALID", "WAIT_FOR_SOURCE", false],
  PROMOTION_LOCKED: ["CATALOG_UPDATE_BUSY", "info", "CONCURRENT_UPDATE", "RETRY", true],
  OPERATION_SUPERSEDED: ["CATALOG_UPDATE_BUSY", "info", "CONCURRENT_UPDATE", "RETRY", true],
  PROMOTION_CAS_MISMATCH: ["CATALOG_UPDATE_BUSY", "info", "CONCURRENT_UPDATE", "REFRESH", true],
  CATALOG_VERSION_INCOMPARABLE: [
    "CATALOG_SOURCE_UNVERIFIED",
    "error",
    "SOURCE_UNVERIFIED",
    "WAIT_FOR_SOURCE",
    false,
  ],
  CATALOG_VERSION_UNKNOWN: [
    "CATALOG_SOURCE_UNVERIFIED",
    "error",
    "SOURCE_UNVERIFIED",
    "WAIT_FOR_SOURCE",
    false,
  ],
});

export async function beginCatalogCheck(runtimeRoot, options = {}) {
  return withPromotionLock(
    runtimeRoot,
    async () => {
      const before = await readLifecycle(runtimeRoot);
      assertExpected(before, options, "catalog check");
      const operationId = options.operationId ?? randomUUID();
      const projection = project(before, {
        operationId,
        attemptedAt: options.attemptedAt ?? new Date().toISOString(),
        phase: "CHECKING",
        outcome: "PENDING",
        requestedReleaseId: options.requestedReleaseId ?? null,
        resolvedReleaseId: null,
        diagnosticId: null,
        capability: capability(before?.stable.activeReleaseId),
        retryable: false,
      });
      await writeProjection(runtimeRoot, projection);
      return { operationId, projection };
    },
    options,
  );
}

export async function promoteDataset(dataset, runtimeRoot, options = {}) {
  return withPromotionLock(
    runtimeRoot,
    async () => {
      let before = await readLifecycle(runtimeRoot);
      assertExpected(before, options, "promotion");
      assertReleaseId(dataset.releaseId, "candidate release");
      const operationId = options.operationId ?? randomUUID();
      if (options.operationId && before?.latest.operationId !== operationId)
        throw new CatalogImportError(
          "OPERATION_SUPERSEDED",
          "Catalog operation was superseded",
          {},
        );
      if (!options.operationId) {
        before = project(before, {
          operationId,
          attemptedAt: options.attemptedAt ?? new Date().toISOString(),
          phase: "CHECKING",
          outcome: "PENDING",
          requestedReleaseId: options.requestedReleaseId ?? dataset.releaseId,
          resolvedReleaseId: null,
          diagnosticId: null,
          capability: capability(before?.stable.activeReleaseId),
          retryable: false,
        });
        await writeProjection(runtimeRoot, before);
      }
      const stableBefore = before?.stable ?? emptyStable();
      const requestedReleaseId = options.requestedReleaseId ?? dataset.releaseId;
      assertReleaseId(requestedReleaseId, "requested release");
      try {
        const candidateOrder = await compareCandidateOrder(dataset, stableBefore, runtimeRoot);
        if (candidateOrder === "INCOMPARABLE" || candidateOrder === "UNKNOWN")
          throw new CatalogImportError(
            `CATALOG_VERSION_${candidateOrder}`,
            "Catalog version cannot safely replace the active release",
            {},
          );
        const current = candidateOrder === "EQUAL";
        const stale = candidateOrder === "OLDER";
        let latestProjection = project(before, {
          operationId,
          attemptedAt: before.latest.attemptedAt,
          phase: "RESOLVED",
          outcome: stale ? "STALE" : current ? "SUCCESS" : "UPDATE_AVAILABLE",
          requestedReleaseId,
          resolvedReleaseId: dataset.releaseId,
          diagnosticId: null,
          capability: capability(stableBefore.activeReleaseId),
          retryable: false,
        });
        await writeOperation(runtimeRoot, latestProjection, "PROMOTE");
        await writeProjection(runtimeRoot, latestProjection);
        await inject(options, "after-resolved");
        if (stale || current) return latestProjection;
        latestProjection = project(latestProjection, {
          ...latestProjection.latest,
          phase: "PROMOTING",
          outcome: "UPDATE_AVAILABLE",
        });
        await writeProjection(runtimeRoot, latestProjection);
        const release = await prepareRelease(dataset, runtimeRoot);
        await inject(options, "after-release");
        await verifyRelease(release, dataset.releaseId);
        await inject(options, "after-operation");
        await inject(options, "before-lifecycle");
        const success = project(
          latestProjection,
          {
            ...latestProjection.latest,
            phase: "SUCCESS",
            outcome: "SUCCESS",
            capability: "ACTIVE",
          },
          {
            activeReleaseId: dataset.releaseId,
            lastKnownGoodReleaseId: stableBefore.activeReleaseId,
          },
        );
        await writeOperation(runtimeRoot, success, "PROMOTE");
        // Atomic projection replacement is the final fallible commit point.
        await writeProjection(runtimeRoot, success);
        return success;
      } catch (error) {
        await recordFailureLocked(runtimeRoot, error, {
          operationId,
          action: "PROMOTE",
          requestedReleaseId,
          resolvedReleaseId: dataset.releaseId,
        });
        throw error;
      }
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
      const operationId = options.operationId ?? randomUUID();
      const stableBefore = before?.stable ?? emptyStable();
      let projection = project(before, {
        operationId,
        attemptedAt: options.attemptedAt ?? new Date().toISOString(),
        phase: "CHECKING",
        outcome: "PENDING",
        requestedReleaseId: releaseId,
        resolvedReleaseId: null,
        diagnosticId: null,
        capability: capability(stableBefore.activeReleaseId),
        retryable: false,
      });
      await writeProjection(runtimeRoot, projection);
      try {
        const release = path.join(runtimeRoot, "releases", releaseId);
        await verifyRelease(release, releaseId);
        projection = project(projection, {
          ...projection.latest,
          phase: "RESOLVED",
          outcome: stableBefore.activeReleaseId === releaseId ? "STALE" : "UPDATE_AVAILABLE",
          resolvedReleaseId: releaseId,
        });
        await writeProjection(runtimeRoot, projection);
        if (stableBefore.activeReleaseId === releaseId) return projection;
        projection = project(projection, { ...projection.latest, phase: "PROMOTING" });
        await writeProjection(runtimeRoot, projection);
        await inject(options, "before-lifecycle");
        const success = project(
          projection,
          { ...projection.latest, phase: "SUCCESS", outcome: "SUCCESS", capability: "ACTIVE" },
          {
            activeReleaseId: releaseId,
            lastKnownGoodReleaseId: stableBefore.activeReleaseId,
          },
        );
        await writeOperation(runtimeRoot, success, "ROLLBACK");
        await writeProjection(runtimeRoot, success);
        return success;
      } catch (error) {
        await recordFailureLocked(runtimeRoot, error, {
          operationId,
          action: "ROLLBACK",
          requestedReleaseId: releaseId,
          resolvedReleaseId: null,
        });
        throw error;
      }
    },
    options,
  );
}

export async function recordOperationalFailure(runtimeRoot, error, options = {}) {
  if (typeof options === "string") options = { attemptedAt: options };
  return withPromotionLock(
    runtimeRoot,
    async () => recordFailureLocked(runtimeRoot, error, options),
    options,
  );
}

async function recordFailureLocked(runtimeRoot, error, options) {
  const before = await readLifecycle(runtimeRoot);
  const operationId = options.operationId ?? (await createOperationId(runtimeRoot));
  const superseded = options.operationId && before?.latest.operationId !== operationId;
  const diagnostic = createOperationalDiagnostic(error, before?.stable.activeReleaseId ?? null);
  await mkdir(path.join(runtimeRoot, "diagnostics"), { recursive: true });
  await writeJsonAtomic(
    path.join(runtimeRoot, "diagnostics", `${diagnostic.diagnosticId}.json`),
    diagnostic,
  );
  const failed = project(before, {
    operationId,
    attemptedAt: options.attemptedAt ?? before?.latest.attemptedAt ?? new Date().toISOString(),
    phase: "FAILURE",
    outcome: before?.stable.activeReleaseId ? "UPDATE_FAILED_USING_LKG" : "UNAVAILABLE",
    requestedReleaseId: options.requestedReleaseId ?? before?.latest.requestedReleaseId ?? null,
    resolvedReleaseId: options.resolvedReleaseId ?? before?.latest.resolvedReleaseId ?? null,
    diagnosticId: diagnostic.diagnosticId,
    capability: capability(before?.stable.activeReleaseId),
    retryable: diagnostic.retryable,
  });
  await writeOperation(runtimeRoot, failed, options.action ?? "PROMOTE");
  if (!superseded) await writeProjection(runtimeRoot, failed);
  return { operationId, diagnosticId: diagnostic.diagnosticId, superseded: Boolean(superseded) };
}

export function createOperationalDiagnostic(error, activeReleaseId) {
  const internalCode = error && typeof error === "object" && "code" in error ? error.code : "";
  const [code, severity, reason, action, retryable] = diagnosticRules[internalCode] ?? [
    "CATALOG_UPDATE_FAILED",
    "error",
    "UNKNOWN_FAILURE",
    "RETRY",
    true,
  ];
  return {
    schemaVersion: 1,
    diagnosticId: randomUUID(),
    code,
    severity,
    title: activeReleaseId ? "Catalog update failed; using last known good" : "Catalog unavailable",
    reason,
    capability: capability(activeReleaseId),
    action,
    retryable,
    active: { available: Boolean(activeReleaseId), releaseId: activeReleaseId },
  };
}

export async function readLifecycle(runtimeRoot) {
  try {
    const value = JSON.parse(await readFile(path.join(runtimeRoot, "lifecycle.json"), "utf8"));
    validateProjection(value);
    return value;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return undefined;
    throw new CatalogImportError(
      "LIFECYCLE_INVALID",
      "Catalog lifecycle projection is invalid",
      {},
    );
  }
}

export async function readCurrent(runtimeRoot) {
  const lifecycle = await readLifecycle(runtimeRoot);
  return lifecycle?.stable.activeReleaseId
    ? { releaseId: lifecycle.stable.activeReleaseId }
    : undefined;
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
  } catch {
    throw new CatalogImportError(
      "RELEASE_INVALID",
      "Catalog release failed integrity verification",
      {},
    );
  }
}

function project(before, latest, stable = before?.stable ?? emptyStable()) {
  return { schemaVersion: 2, stable, latest };
}

function emptyStable() {
  return { activeReleaseId: null, lastKnownGoodReleaseId: null };
}

function capability(activeReleaseId) {
  return activeReleaseId ? "LAST_KNOWN_GOOD" : "UNAVAILABLE";
}

function validateProjection(value) {
  const phases = new Set(["CHECKING", "RESOLVED", "PROMOTING", "SUCCESS", "FAILURE"]);
  const outcomes = new Set([
    "PENDING",
    "UPDATE_AVAILABLE",
    "STALE",
    "SUCCESS",
    "UPDATE_FAILED_USING_LKG",
    "UNAVAILABLE",
  ]);
  if (value?.schemaVersion !== 2 || !value.stable || !value.latest) throw new Error("schema");
  for (const key of ["activeReleaseId", "lastKnownGoodReleaseId"])
    if (value.stable[key] !== null && !isReleaseId(value.stable[key])) throw new Error("stable");
  if (!phases.has(value.latest.phase) || !outcomes.has(value.latest.outcome))
    throw new Error("state");
  if (typeof value.latest.operationId !== "string" || !value.latest.operationId)
    throw new Error("operation");
  if (!Number.isFinite(Date.parse(value.latest.attemptedAt))) throw new Error("attemptedAt");
  for (const key of ["requestedReleaseId", "resolvedReleaseId"])
    if (value.latest[key] !== null && !isReleaseId(value.latest[key]))
      throw new Error("latest hash");
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

async function compareCandidateOrder(dataset, stable, runtimeRoot) {
  if (!stable.activeReleaseId) return "NEWER";
  if (stable.activeReleaseId === dataset.releaseId) return "EQUAL";

  const activeDirectory = path.join(runtimeRoot, "releases", stable.activeReleaseId);
  await verifyRelease(activeDirectory, stable.activeReleaseId);
  const activeManifest = JSON.parse(
    await readFile(path.join(activeDirectory, "manifest.json"), "utf8"),
  );
  return compareCatalogVersions(dataset, {
    releaseId: stable.activeReleaseId,
    manifest: activeManifest,
  });
}

async function createOperationId(runtimeRoot) {
  let operationId;
  do operationId = randomUUID();
  while (await exists(path.join(runtimeRoot, "operations", `${operationId}.json`)));
  return operationId;
}

function assertExpected(before, options, action) {
  const actual = before?.stable.activeReleaseId ?? null;
  const expected = Object.hasOwn(options, "expectedCurrent") ? options.expectedCurrent : actual;
  if (actual !== expected)
    throw new CatalogImportError(
      "PROMOTION_CAS_MISMATCH",
      `Current catalog changed before ${action}`,
      {},
    );
}

async function writeOperation(runtimeRoot, projection, action) {
  await mkdir(path.join(runtimeRoot, "operations"), { recursive: true });
  await writeJsonAtomic(
    path.join(runtimeRoot, "operations", `${projection.latest.operationId}.json`),
    { schemaVersion: 2, action, stable: projection.stable, latest: projection.latest },
  );
}

async function writeProjection(runtimeRoot, projection) {
  await writeJsonAtomic(path.join(runtimeRoot, "lifecycle.json"), projection);
}

async function withPromotionLock(runtimeRoot, operation, options = {}) {
  await mkdir(runtimeRoot, { recursive: true });
  const lock = path.join(runtimeRoot, ".promotion-lock");
  try {
    await mkdir(lock);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST")
      throw new CatalogImportError(
        "PROMOTION_LOCKED",
        "Another catalog operation is in progress",
        {},
      );
    throw error;
  }
  try {
    return await operation();
  } finally {
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
