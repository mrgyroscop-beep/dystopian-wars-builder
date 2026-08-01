import process from "node:process";

import { chromium } from "@playwright/test";

import { assertFullSha } from "./core.mjs";

const baseUrl = new URL(process.argv[2]);
if (
  baseUrl.protocol !== "https:" ||
  !baseUrl.hostname.endsWith(".workers.dev") ||
  baseUrl.hostname === "localhost" ||
  baseUrl.port ||
  baseUrl.username ||
  baseUrl.password
) {
  throw new Error("Preview smoke requires an isolated workers.dev HTTPS origin");
}
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

await runBrowserContract();

console.log(JSON.stringify({ event: "preview_smoke_passed", commitSha: expectedSha }));

async function request(pathname, init) {
  return fetch(new URL(pathname, baseUrl), { ...init, redirect: "error" });
}

async function runBrowserContract() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { width: 1280, height: 800 },
      { width: 360, height: 800 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto(new URL("/rosters/scaffold-demo", baseUrl).toString(), {
        waitUntil: "networkidle",
      });
      if (new URL(page.url()).pathname !== "/rosters/scaffold-demo") {
        throw new Error("Deployed deep link did not preserve the KAN-29 route");
      }
      await assertSemanticAndResponsivePage(page);

      if (viewport.width === 1280) {
        await page.goto(new URL("/", baseUrl).toString(), { waitUntil: "networkidle" });
        await page.keyboard.press("Tab");
        const focusedHref = await page.locator(":focus").getAttribute("href");
        if (focusedHref !== "#main-content") throw new Error("Deployed skip link is not first");
        await page.keyboard.press("Enter");
        if ((await page.locator("main:focus").count()) !== 1) {
          throw new Error("Deployed skip link does not focus main content");
        }

        for (const state of ["loading", "empty", "error", "success"]) {
          await page.goto(new URL(`/?state=${state}`, baseUrl).toString(), {
            waitUntil: "networkidle",
          });
          if ((await page.locator(`[data-state="${state}"]`).count()) !== 1) {
            throw new Error(`Deployed ${state} state is unavailable`);
          }
          await assertSemanticAndResponsivePage(page);
        }
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

async function assertSemanticAndResponsivePage(page) {
  const evidence = await page.evaluate(() => ({
    h1: globalThis.document.querySelectorAll("h1").length,
    header: globalThis.document.querySelectorAll("header.site-header").length,
    nav: globalThis.document.querySelectorAll("nav").length,
    main: globalThis.document.querySelectorAll("main").length,
    viewportWidth: globalThis.document.documentElement.clientWidth,
    scrollWidth: globalThis.document.documentElement.scrollWidth,
  }));
  if (
    evidence.h1 !== 1 ||
    evidence.header !== 1 ||
    evidence.nav < 1 ||
    evidence.main !== 1 ||
    evidence.scrollWidth > evidence.viewportWidth
  ) {
    throw new Error("Deployed semantic or responsive KAN-29 contract failed");
  }
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
