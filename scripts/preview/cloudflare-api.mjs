import process from "node:process";

import { PreviewBootstrapError, assertAllowlistedWorkerName } from "./core.mjs";

export async function ensurePreviewWorkerForUpload({
  existedBefore,
  name,
  prNumber,
  bootstrap = bootstrapPreviewWorker,
}) {
  assertAllowlistedWorkerName(name, prNumber);
  if (existedBefore) return false;
  await bootstrap(name, prNumber);
  return true;
}

export async function bootstrapPreviewWorker(name, expectedPrNumber, request = cloudflareRequest) {
  assertAllowlistedWorkerName(name, expectedPrNumber);

  let worker;
  try {
    worker = await request("/workers/workers", {
      method: "POST",
      body: JSON.stringify({
        name,
        subdomain: { enabled: true, previews_enabled: true },
      }),
    });
  } catch {
    throw new PreviewBootstrapError("create-worker");
  }

  const stage = worker?.name === name ? "configure-subdomain" : "create-worker";
  if (
    worker?.name !== name ||
    worker?.subdomain?.enabled !== true ||
    worker?.subdomain?.previews_enabled !== true
  ) {
    try {
      await deleteBootstrappedPreviewWorker(name, expectedPrNumber, request);
    } catch {
      throw new PreviewBootstrapError("cleanup-worker");
    }
    throw new PreviewBootstrapError(stage);
  }
}

export async function deleteBootstrappedPreviewWorker(
  name,
  expectedPrNumber,
  request = cloudflareRequest,
) {
  assertAllowlistedWorkerName(name, expectedPrNumber);
  try {
    await request(`/workers/workers/${encodeURIComponent(name)}`, { method: "DELETE" }, true);
    const [workerResources, scripts] = await Promise.all([
      request("/workers/workers"),
      request("/workers/scripts"),
    ]);
    if (
      normalizeCollection(workerResources).some((worker) => worker?.name === name) ||
      normalizeCollection(scripts).some((worker) => worker?.id === name)
    ) {
      throw new Error("Preview Worker still exists after cleanup");
    }
  } catch {
    throw new PreviewBootstrapError("cleanup-worker");
  }
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

function normalizeCollection(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.items) ? value.items : [];
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
