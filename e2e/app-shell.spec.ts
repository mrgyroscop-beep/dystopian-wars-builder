import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const reviewSha = resolveReviewSha();

function resolveReviewSha(): string {
  const candidate =
    process.env.REVIEW_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  const normalized = candidate.trim().toLowerCase();

  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`Review SHA must be a full 40-character commit SHA, received: ${candidate}`);
  }

  return normalized;
}

interface EvidenceDescriptor {
  route: string;
  state: string;
  viewport: { name: string; width: number; height: number };
}

async function collectDomEvidence(page: Page) {
  return page.evaluate(() => ({
    h1Count: document.querySelectorAll("h1").length,
    headerCount: document.querySelectorAll("header.site-header").length,
    navCount: document.querySelectorAll("nav[aria-label='Основная навигация']").length,
    mainCount: document.querySelectorAll("main").length,
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    title: document.title,
    h1: document.querySelector("h1")?.textContent?.trim() ?? null,
  }));
}

async function captureReviewEvidence(
  page: Page,
  descriptor: EvidenceDescriptor,
  directory: string,
  basename: string,
) {
  const dom = await collectDomEvidence(page);
  const metadata = {
    reviewSha,
    route: descriptor.route,
    state: descriptor.state,
    viewport: descriptor.viewport,
    dom,
  };

  expect(dom.h1Count).toBe(1);
  expect(dom.headerCount).toBe(1);
  expect(dom.navCount).toBe(1);
  expect(dom.mainCount).toBe(1);
  expect(dom.scrollWidth).toBeLessThanOrEqual(dom.viewportWidth);

  await mkdir(directory, { recursive: true });
  await Promise.all([
    page.screenshot({
      path: path.join(directory, `${basename}.png`),
      fullPage: true,
    }),
    writeFile(
      path.join(directory, `${basename}.json`),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    ),
  ]);

  return metadata;
}

test("supports SPA routes, keyboard navigation and browser history", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1, name: "Мои флоты" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Флоты" })).toHaveAttribute("aria-current", "page");

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Перейти к содержимому" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  await page.getByRole("link", { name: "Настройки" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Настройки" })).toBeVisible();
  await expect(page.getByText("Доступен")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Мои флоты" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1, name: "Настройки" })).toBeVisible();
});

test("serves a deep SPA link and a controlled 404", async ({ page }) => {
  await page.goto("/rosters/scaffold-demo");
  await expect(page.getByRole("heading", { level: 1, name: "Черновик флота" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Каталог" })).toBeVisible();

  await page.goto("/does-not-exist");
  await expect(page.getByRole("heading", { level: 1, name: "Такого маршрута нет" })).toBeVisible();
  await expect(page.getByText("/does-not-exist")).toBeVisible();
});

test("returns a valid Worker health response", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  await expect(response).toBeOK();
  expect(await response.json()).toEqual({
    status: "ok",
    appVersion: "0.1.0",
    catalogVersion: "not-imported",
  });
});

for (const state of ["loading", "empty", "error", "success"] as const) {
  test(`renders the ${state} fixture with semantic text`, async ({ page }) => {
    await page.goto(`/?state=${state}`);
    await expect(page.locator(`[data-state="${state}"]`)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Мои флоты" })).toBeVisible();
  });
}

test("keeps the roster workspace usable with 200% text scaling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/rosters/scaffold-demo");
  await page.locator("html").evaluate((element) => {
    element.style.fontSize = "200%";
  });

  await expect(page.getByRole("heading", { level: 1, name: "Черновик флота" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Каталог" })).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth);
});

const evidenceViewports = [
  { name: "desktop-1280x800", width: 1280, height: 800 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "mobile-360x800", width: 360, height: 800 },
] as const;

for (const viewport of evidenceViewports) {
  test(`captures ${viewport.name} without horizontal overflow`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/rosters/scaffold-demo");

    const screenshotDirectory = path.resolve("artifacts/screenshots");
    const a11yDirectory = path.resolve("artifacts/a11y");
    const metadata = await captureReviewEvidence(
      page,
      { route: "/rosters/scaffold-demo", state: "workspace", viewport },
      screenshotDirectory,
      viewport.name,
    );
    await mkdir(a11yDirectory, { recursive: true });
    await writeFile(
      path.join(a11yDirectory, `${viewport.name}.json`),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    );
  });
}

const reviewViewports = [
  { name: "desktop-1280x800", width: 1280, height: 800 },
  { name: "mobile-360x800", width: 360, height: 800 },
] as const;

const routeEvidence = [
  { slug: "library", route: "/", state: "default" },
  { slug: "new-roster", route: "/rosters/new", state: "default" },
  { slug: "settings", route: "/settings", state: "success" },
  { slug: "not-found", route: "/does-not-exist", state: "not-found" },
  { slug: "library-loading", route: "/?state=loading", state: "loading" },
  { slug: "library-empty", route: "/?state=empty", state: "empty" },
  { slug: "library-error", route: "/?state=error", state: "error" },
  { slug: "library-success", route: "/?state=success", state: "success" },
] as const;

for (const viewport of reviewViewports) {
  for (const evidence of routeEvidence) {
    test(`captures ${evidence.slug} evidence at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(evidence.route);
      await expect(page.locator("h1")).toBeVisible();

      if (evidence.route.startsWith("/?state=")) {
        await expect(page.locator(`[data-state="${evidence.state}"]`)).toBeVisible();
      }
      if (evidence.slug === "settings") {
        await expect(page.getByText("Доступен")).toBeVisible();
      }

      await captureReviewEvidence(
        page,
        { route: evidence.route, state: evidence.state, viewport },
        path.resolve("artifacts/review-evidence", evidence.slug),
        viewport.name,
      );
    });
  }
}
