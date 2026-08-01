import process from "node:process";

import { assertAllowlistedWorkerName } from "./core.mjs";

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
