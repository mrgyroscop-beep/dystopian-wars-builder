import { randomUUID } from "node:crypto";
import process from "node:process";

import { PreviewBootstrapError, assertAllowlistedWorkerName } from "./core.mjs";

const OWNERSHIP_TAG_PATTERN =
  /^dwb-preview-owner-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const RECONCILIATION_ATTEMPTS = 3;

export async function ensurePreviewWorkerForUpload({
  existedBefore,
  name,
  prNumber,
  ownershipTag,
  bootstrap = bootstrapPreviewWorker,
  request,
}) {
  assertAllowlistedWorkerName(name, prNumber);
  if (existedBefore) return undefined;
  const attemptOwnershipTag = ownershipTag ?? createPreviewOwnershipTag();
  return bootstrap({
    name,
    prNumber,
    ownershipTag: attemptOwnershipTag,
    ...(request ? { request } : {}),
  });
}

export async function bootstrapPreviewWorker({
  name,
  prNumber,
  ownershipTag,
  request = cloudflareRequest,
  wait = defaultWait,
}) {
  assertAllowlistedWorkerName(name, prNumber);
  assertOwnershipTag(ownershipTag);

  try {
    await guardedRequest(name, prNumber, request, "/workers/workers", {
      method: "POST",
      body: JSON.stringify({
        name,
        subdomain: { enabled: true, previews_enabled: true },
        tags: [ownershipTag],
      }),
    });
  } catch {
    // An interrupted response is ambiguous: the atomic create may have committed.
    // Ownership is established only from fresh provider state below.
  }

  let evidence;
  for (let attempt = 0; attempt < RECONCILIATION_ATTEMPTS; attempt += 1) {
    try {
      evidence = await readOwnershipEvidence({ name, prNumber, ownershipTag, request });
    } catch {
      evidence = undefined;
    }
    if (evidence?.owned || evidence?.conflictingOwner) break;
    if (attempt + 1 < RECONCILIATION_ATTEMPTS) await wait(100 * (attempt + 1));
  }

  if (!evidence?.owned) throw new PreviewBootstrapError("reconcile-worker");

  if (!evidence.readyForFirstUpload) {
    try {
      await deleteBootstrappedPreviewWorker({ name, prNumber, ownershipTag, request });
    } catch {
      throw new PreviewBootstrapError("cleanup-worker");
    }
    throw new PreviewBootstrapError(
      evidence.configured ? "reconcile-worker" : "configure-subdomain",
    );
  }

  return ownershipTag;
}

export async function deleteBootstrappedPreviewWorker({
  name,
  prNumber,
  ownershipTag,
  request = cloudflareRequest,
}) {
  assertAllowlistedWorkerName(name, prNumber);
  assertOwnershipTag(ownershipTag);
  try {
    // This is the final provider re-fetch before the destructive request. The
    // standalone resource may only be deleted while every safety invariant is
    // still present in both provider views.
    const evidence = await readOwnershipEvidence({ name, prNumber, ownershipTag, request });
    if (!evidence.readyForFirstUpload) throw new Error("Worker ownership is not proven");

    await guardedRequest(
      name,
      prNumber,
      request,
      `/workers/workers/${encodeURIComponent(name)}`,
      { method: "DELETE" },
      true,
    );
    await assertPreviewWorkerAbsent({ name, prNumber, request });
  } catch {
    throw new PreviewBootstrapError("cleanup-worker");
  }
}

export async function deleteBootstrappedPreviewAfterUpload({
  name,
  prNumber,
  ownershipTag,
  request = cloudflareRequest,
}) {
  assertAllowlistedWorkerName(name, prNumber);
  assertOwnershipTag(ownershipTag);
  try {
    // Recovery re-establishes exclusive ownership from every provider view.
    // Pre-upload observations are never trusted for deletion.
    const evidence = await readOwnershipEvidence({ name, prNumber, ownershipTag, request });
    if (!evidence.owned || !evidence.inventoryValid) {
      throw new Error("Worker ownership is not proven");
    }

    if (!evidence.scriptExists) {
      await deleteBootstrappedPreviewWorker({ name, prNumber, ownershipTag, request });
      return;
    }

    await guardedRequest(
      name,
      prNumber,
      request,
      `/workers/scripts/${encodeURIComponent(name)}`,
      { method: "DELETE" },
      true,
    );
    await assertPreviewWorkerAbsent({ name, prNumber, request });
  } catch {
    throw new PreviewBootstrapError("cleanup-worker");
  }
}

export async function listPreviewWorkersForUpload(
  name,
  expectedPrNumber,
  request = cloudflareRequest,
) {
  assertAllowlistedWorkerName(name, expectedPrNumber);
  const [workerResources, scripts] = await Promise.all([
    guardedRequest(name, expectedPrNumber, request, "/workers/workers"),
    guardedRequest(name, expectedPrNumber, request, "/workers/scripts"),
  ]);
  return [
    ...normalizeCollection(workerResources).map((worker) => worker?.name),
    ...normalizeCollection(scripts).map((worker) => worker?.id),
  ]
    .filter(
      (workerName) => typeof workerName === "string" && /^dwb-pr-[1-9][0-9]*$/.test(workerName),
    )
    .filter((workerName, index, workers) => workers.indexOf(workerName) === index)
    .sort();
}

export async function listPreviewWorkers() {
  const result = await cloudflareRequest("/workers/scripts");
  const workers = Array.isArray(result) ? result : [];
  return workers
    .map((worker) => worker?.id)
    .filter((name) => typeof name === "string" && /^dwb-pr-[1-9][0-9]*$/.test(name));
}

export async function deletePreviewWorker(name, expectedPrNumber) {
  assertAllowlistedWorkerName(name, expectedPrNumber);
  await cloudflareRequest(
    `/workers/scripts/${encodeURIComponent(name)}`,
    { method: "DELETE" },
    true,
  );
}

export async function latestPreviewVersionTimestamp(name) {
  assertAllowlistedWorkerName(name);
  const result = await cloudflareRequest(`/workers/scripts/${encodeURIComponent(name)}/versions`);
  const versions = Array.isArray(result?.items)
    ? result.items
    : Array.isArray(result)
      ? result
      : [];
  const timestamps = versions
    .map((version) => version?.metadata?.created_on ?? version?.created_on)
    .filter((value) => typeof value === "string")
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.valueOf()))
    .sort((left, right) => right.valueOf() - left.valueOf());
  return timestamps[0];
}

async function readOwnershipEvidence({ name, prNumber, ownershipTag, request }) {
  const [workerResources, scripts] = await Promise.all([
    guardedRequest(name, prNumber, request, "/workers/workers"),
    guardedRequest(name, prNumber, request, "/workers/scripts"),
  ]);
  // Read the exact resource last so a mutation during either inventory read is
  // observed before the destructive request.
  const exactWorker = await guardedRequest(
    name,
    prNumber,
    request,
    `/workers/workers/${encodeURIComponent(name)}`,
    undefined,
    true,
  );
  const resources = strictCollection(workerResources);
  const scriptEntries = strictCollection(scripts);
  const resourcesWellFormed = resources?.every((worker) => typeof worker?.name === "string");
  const scriptsWellFormed = scriptEntries?.every((script) => typeof script?.id === "string");
  const targetResources = resources?.filter((worker) => worker?.name === name);
  const targetScripts = scriptEntries?.filter((script) => script?.id === name);
  const inventoryValid =
    resourcesWellFormed === true &&
    scriptsWellFormed === true &&
    targetResources.length === 1 &&
    targetScripts.length <= 1;
  const inventoryAmbiguous =
    resourcesWellFormed !== true ||
    scriptsWellFormed !== true ||
    targetResources?.length > 1 ||
    targetScripts?.length > 1;
  const listedWorker = targetResources?.[0];
  const exactOwned = isExclusivelyOwnedEmptyPreviewWorker(exactWorker, name, ownershipTag);
  const listedOwned = isExclusivelyOwnedEmptyPreviewWorker(listedWorker, name, ownershipTag);
  const owned = inventoryValid && exactOwned && listedOwned;
  const scriptExists = inventoryValid && targetScripts.length === 1;
  return {
    owned,
    configured: owned,
    inventoryValid,
    scriptExists,
    readyForFirstUpload: owned && !scriptExists,
    conflictingOwner:
      inventoryAmbiguous ||
      (exactWorker !== undefined && !exactOwned) ||
      (listedWorker !== undefined && !listedOwned),
  };
}

async function assertPreviewWorkerAbsent({ name, prNumber, request }) {
  const [exactWorker, workerResources, scripts] = await Promise.all([
    guardedRequest(
      name,
      prNumber,
      request,
      `/workers/workers/${encodeURIComponent(name)}`,
      undefined,
      true,
    ),
    guardedRequest(name, prNumber, request, "/workers/workers"),
    guardedRequest(name, prNumber, request, "/workers/scripts"),
  ]);
  const resources = strictCollection(workerResources);
  const scriptEntries = strictCollection(scripts);
  if (
    exactWorker !== undefined ||
    resources === undefined ||
    scriptEntries === undefined ||
    resources.some((worker) => worker?.name === name) ||
    scriptEntries.some((script) => script?.id === name)
  ) {
    throw new Error("Preview Worker still exists after cleanup");
  }
}

function isExclusivelyOwnedEmptyPreviewWorker(worker, name, ownershipTag) {
  return (
    worker?.name === name &&
    Array.isArray(worker.tags) &&
    worker.tags.length === 1 &&
    worker.tags[0] === ownershipTag &&
    worker.deployed_on === null &&
    worker.subdomain?.enabled === true &&
    worker.subdomain?.previews_enabled === true
  );
}

function createPreviewOwnershipTag() {
  return `dwb-preview-owner-${randomUUID()}`;
}

function assertOwnershipTag(value) {
  if (typeof value !== "string" || !OWNERSHIP_TAG_PATTERN.test(value)) {
    throw new PreviewBootstrapError("reconcile-worker");
  }
  return value;
}

function guardedRequest(name, expectedPrNumber, request, pathname, init, acceptNotFound) {
  assertAllowlistedWorkerName(name, expectedPrNumber);
  if (acceptNotFound !== undefined) return request(pathname, init, acceptNotFound);
  if (init !== undefined) return request(pathname, init);
  return request(pathname);
}

function normalizeCollection(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.items) ? value.items : [];
}

function strictCollection(value) {
  if (Array.isArray(value)) return value;
  if (value !== null && typeof value === "object" && Array.isArray(value.items)) {
    return value.items;
  }
  return undefined;
}

function defaultWait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function cloudflareRequest(pathname, init = {}, acceptNotFound = false) {
  const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${pathname}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${requiredEnvironment("CLOUDFLARE_API_TOKEN")}`,
        "Content-Type": "application/json",
      },
    },
  );
  const payload = await response.json().catch(() => undefined);
  if (
    (!response.ok || payload?.success === false) &&
    !(acceptNotFound && response.status === 404)
  ) {
    throw new Error(`Cloudflare operation failed with status ${response.status}`);
  }
  return response.status === 404 ? undefined : payload?.result;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
