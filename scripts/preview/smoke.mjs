import process from "node:process";

import { assertFullSha } from "./core.mjs";

const baseUrl = new URL(process.argv[2]);
if (baseUrl.protocol !== "https:") throw new Error("Preview smoke requires HTTPS");
const expectedSha = assertFullSha(process.argv[3], "expectedSha");

const root = await request("/");
assertStatus(root, 200, "root");
assertSecurityHeaders(root, "root");

const deepLink = await request("/rosters/scaffold-demo");
assertStatus(deepLink, 200, "deep link");
assertSecurityHeaders(deepLink, "deep link");

const health = await request("/api/health", { headers: { Accept: "application/json" } });
assertStatus(health, 200, "health");
assertSecurityHeaders(health, "health");
if (health.headers.get("cache-control") !== "no-store")
  throw new Error("Health response is cacheable");
const payload = await health.json();
if (
  payload.status !== "ok" ||
  payload.environment !== "preview" ||
  payload.commitSha !== expectedSha
) {
  throw new Error("Health response does not identify the exact preview commit");
}

const missing = await request("/api/preview-contract-missing", {
  headers: { Accept: "application/json" },
});
assertStatus(missing, 404, "API 404");
assertSecurityHeaders(missing, "API 404");
const missingPayload = await missing.json();
if (missingPayload?.error?.code !== "not_found") throw new Error("API 404 is not structured JSON");

const html = await root.text();
const asset = /(?:src|href)=["']([^"']*\/assets\/[^"']+)["']/.exec(html)?.[1];
if (!asset || !/-[A-Za-z0-9_-]{6,}\./.test(asset))
  throw new Error("Hashed asset was not found in the app shell");
assertStatus(await request(asset), 200, "hashed asset");

console.log(JSON.stringify({ event: "preview_smoke_passed", commitSha: expectedSha }));

async function request(pathname, init) {
  return fetch(new URL(pathname, baseUrl), { ...init, redirect: "error" });
}

function assertStatus(response, expected, label) {
  if (response.status !== expected) throw new Error(`${label} returned ${response.status}`);
}

function assertSecurityHeaders(response, label) {
  if (response.headers.get("x-content-type-options") !== "nosniff")
    throw new Error(`${label} lacks nosniff`);
  if (response.headers.get("referrer-policy") !== "no-referrer")
    throw new Error(`${label} lacks referrer policy`);
  if (!response.headers.get("content-security-policy")?.includes("frame-ancestors 'none'")) {
    throw new Error(`${label} lacks frame-ancestors CSP`);
  }
  if (response.headers.has("strict-transport-security"))
    throw new Error(`${label} must not set HSTS yet`);
}
