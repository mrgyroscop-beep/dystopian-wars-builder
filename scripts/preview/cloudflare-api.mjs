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
    const evidence = await readOwnershipEvidence({ name, prNumber, ownershipTag, request });
    if (!evidence.owned) throw new Error("Worker ownership is not proven");

    await guardedRequest(
      name,
      prNumber,
      request,
      `/workers/workers/${encodeURIComponent(name)}`,
      { method: "DELETE" },
      true,
    );
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
    if (
      exactWorker !== undefined ||
      normalizeCollection(workerResources).some((worker) => worker?.name === name) ||
      normalizeCollection(scripts).some((worker) => worker?.id === name)
    ) {
      throw new Error("Preview Worker still exists after cleanup");
    }
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
  const listedWorker = normalizeCollection(workerResources).find((worker) => worker?.name === name);
  const exactOwned = isOwnedEmptyWorker(exactWorker, name, ownershipTag);
  const listedOwned = isOwnedEmptyWorker(listedWorker, name, ownershipTag);
  const owned = exactOwned && listedOwned;
  const configured =
    owned &&
    exactWorker.subdomain?.enabled === true &&
    exactWorker.subdomain?.previews_enabled === true &&
    listedWorker.subdomain?.enabled === true &&
    listedWorker.subdomain?.previews_enabled === true;
  const scriptExists = normalizeCollection(scripts).some((script) => script?.id === name);
  return {
    owned,
    configured,
    readyForFirstUpload: owned && configured && !scriptExists,
    conflictingOwner:
      hasDifferentOwner(exactWorker, ownershipTag) || hasDifferentOwner(listedWorker, ownershipTag),
  };
}

function isOwnedEmptyWorker(worker, name, ownershipTag) {
  return (
    worker?.name === name &&
    Array.isArray(worker.tags) &&
    worker.tags.includes(ownershipTag) &&
    worker.deployed_on === null
  );
}

function hasDifferentOwner(worker, ownershipTag) {
  return (
    worker !== undefined &&
    Array.isArray(worker?.tags) &&
    worker.tags.some((tag) => tag !== ownershipTag)
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
