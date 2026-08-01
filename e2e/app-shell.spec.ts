import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test } from "@playwright/test";

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

    const domEvidence = await page.evaluate(() => ({
      h1Count: document.querySelectorAll("h1").length,
      headerCount: document.querySelectorAll("header.site-header").length,
      navCount: document.querySelectorAll("nav[aria-label='Основная навигация']").length,
      mainCount: document.querySelectorAll("main").length,
      viewportWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(domEvidence.h1Count).toBe(1);
    expect(domEvidence.headerCount).toBe(1);
    expect(domEvidence.navCount).toBe(1);
    expect(domEvidence.mainCount).toBe(1);
    expect(domEvidence.scrollWidth).toBeLessThanOrEqual(domEvidence.viewportWidth);

    const screenshotDirectory = path.resolve("artifacts/screenshots");
    const a11yDirectory = path.resolve("artifacts/a11y");
    await Promise.all([
      mkdir(screenshotDirectory, { recursive: true }),
      mkdir(a11yDirectory, { recursive: true }),
    ]);
    await page.screenshot({
      path: path.join(screenshotDirectory, `${viewport.name}.png`),
      fullPage: true,
    });
    await writeFile(
      path.join(a11yDirectory, `${viewport.name}.json`),
      `${JSON.stringify(domEvidence, null, 2)}\n`,
      "utf8",
    );
  });
}
