import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import axe from "axe-core";

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

async function expectEditorTouchTargets(page: Page) {
  const touchTargets = await page
    .locator(".ship-editor .editor-option, .ship-editor button, .ship-editor input[type=number]")
    .evaluateAll((elements) =>
      elements
        .filter((element) => (element as HTMLElement).offsetParent !== null)
        .map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            label: element.textContent?.trim().slice(0, 40),
            width: bounds.width,
            height: bounds.height,
          };
        }),
    );

  expect(touchTargets.filter((target) => target.width < 44 || target.height < 44)).toEqual([]);
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
  await expect(page.getByRole("heading", { level: 1, name: "Учебная эскадра" })).toBeVisible();
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
    environment: "local",
    appVersion: "0.1.0",
    catalogVersion: "not-imported",
    commitSha: "0000000000000000000000000000000000000000",
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

  await expect(page.getByRole("heading", { level: 1, name: "Учебная эскадра" })).toBeVisible();
  await page.getByRole("button", { name: "Каталог", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Каталог" })).toBeVisible();
  await page.getByLabel("Поиск").fill("Akita Demonstrator");
  await page.getByRole("button", { name: /Akita Demonstrator/u }).click();
  await expect(page.getByText("Только чтение")).toBeVisible();

  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    overflowElements: [...document.querySelectorAll<HTMLElement>("body *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > document.documentElement.clientWidth + 1,
      )
      .slice(0, 8)
      .map((element) => ({
        className: element.className,
        right: Math.round(element.getBoundingClientRect().right),
        tag: element.tagName,
        text: element.textContent?.trim().slice(0, 60),
      })),
  }));

  expect(dimensions.scrollWidth, JSON.stringify(dimensions.overflowElements)).toBeLessThanOrEqual(
    dimensions.viewportWidth,
  );
  await captureReviewEvidence(
    page,
    {
      route: "/rosters/scaffold-demo",
      state: "akita-preview-200-percent",
      viewport: { name: "mobile-360x800-200-percent", width: 360, height: 800 },
    },
    path.resolve("artifacts/review-evidence/akita-preview"),
    "mobile-360x800-200-percent",
  );
});

const evidenceViewports = [
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "desktop-1366x768", width: 1366, height: 768 },
  { name: "desktop-1280x800", width: 1280, height: 800 },
  { name: "desktop-1200x800", width: 1200, height: 800 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "mobile-360x800", width: 360, height: 800 },
  { name: "mobile-320x800", width: 320, height: 800 },
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

    if (viewport.width <= 768)
      await page
        .getByRole("navigation", { name: "Область билдера", exact: true })
        .getByRole("button", { name: "Каталог" })
        .click();
    await page.getByLabel("Поиск").fill("Akita Demonstrator");
    await page.getByRole("button", { name: /Akita Demonstrator/u }).click();
    await expect(page.getByText("Только чтение")).toBeVisible();
    await captureReviewEvidence(
      page,
      { route: "/rosters/scaffold-demo", state: "akita-preview", viewport },
      path.resolve("artifacts/review-evidence/akita-preview"),
      viewport.name,
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

test("creates, persists and restores a demonstration fleet", async ({ page }) => {
  const viewport = { name: "desktop-1280x800", width: 1280, height: 800 } as const;
  await page.setViewportSize(viewport);
  await page.goto("/rosters/new");
  await page.getByLabel("Название флота").fill("Northern Squadron");
  await page.getByLabel("Фракция").selectOption("demo-empire");
  await page.locator('select[name="battlefleetId"]').selectOption("demo-empire-patrol");
  await expect(page.getByRole("heading", { name: "Harbour Patrol" })).toBeVisible();
  await captureReviewEvidence(
    page,
    { route: "/rosters/new", state: "battlefleet-selected", viewport },
    path.resolve("artifacts/review-evidence/new-roster-selected"),
    viewport.name,
  );
  const mobileViewport = { name: "mobile-360x800", width: 360, height: 800 } as const;
  await page.setViewportSize(mobileViewport);
  await captureReviewEvidence(
    page,
    { route: "/rosters/new", state: "battlefleet-selected", viewport: mobileViewport },
    path.resolve("artifacts/review-evidence/new-roster-selected"),
    mobileViewport.name,
  );
  await page.setViewportSize(viewport);
  await page.getByRole("button", { name: "Создать и открыть состав" }).click();

  await expect(page).toHaveURL(/\/rosters\/[a-f0-9-]+$/u);
  await expect(page.getByRole("heading", { level: 1, name: "Northern Squadron" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Flagship Element" })).toBeVisible();
  await expect(page.getByText("112 учебных записей")).toBeVisible();
  const savedId = page.url().split("/").pop()!;

  const beforePreview = await page.evaluate(
    (key) => window.localStorage.getItem(`dwb.roster.v1.${key}`),
    savedId,
  );
  await page.getByLabel("Поиск").fill("Akita Demonstrator");
  await page.getByRole("button", { name: /Akita Demonstrator/u }).click();
  await expect(page.getByRole("heading", { level: 3, name: "Akita Demonstrator" })).toBeVisible();
  expect(
    await page.evaluate((key) => window.localStorage.getItem(`dwb.roster.v1.${key}`), savedId),
  ).toBe(beforePreview);

  await page.getByRole("button", { name: "Добавить в состав" }).click();
  await expect(page.getByText("350 / 1000")).toBeVisible();
  await expect(
    page.locator(".roster-instance-list").getByText("Akita Demonstrator", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Northern Squadron" })).toBeVisible();
  await expect(page.getByText("350 / 1000")).toBeVisible();
  await page.getByRole("button", { name: "Копировать" }).click();
  await expect(page.getByText("700 / 1000")).toBeVisible();

  const persisted = await page.evaluate((key) => {
    const value = window.localStorage.getItem(`dwb.roster.v1.${key}`)!;
    return JSON.parse(value) as {
      roster: { instances: Record<string, { definitionId: string }> };
    };
  }, savedId);
  const shipIds = Object.entries(persisted.roster.instances)
    .filter(([, instance]) => instance.definitionId === "demo-ship-001")
    .map(([id]) => id);
  expect(new Set(shipIds).size).toBe(2);

  await page.getByRole("button", { name: "Удалить" }).first().click();
  await expect(page.getByText("350 / 1000")).toBeVisible();
  expect(
    await page.evaluate((key) => window.localStorage.getItem(`dwb.roster.v1.${key}`), savedId),
  ).not.toBeNull();
});

test("requires an explicit target and keeps unavailable ships previewable", async ({ page }) => {
  await page.goto("/rosters/scaffold-demo");
  await expect(page.getByRole("heading", { level: 1, name: "Учебная эскадра" })).toBeVisible();

  await page.getByLabel("Поиск").fill("Pattern 017");
  await page.getByRole("button", { name: /Pattern 017/u }).click();
  const add = page.getByRole("button", { name: "Добавить в состав" });
  await expect(add).toBeDisabled();
  await expect(page.getByRole("group", { name: "Добавить в Battlefleet Element" })).toBeVisible();
  await page.getByRole("radio", { name: "Line Element" }).check();
  await expect(add).toBeEnabled();
  await add.click();
  await expect(
    page.locator(".roster-instance-list").getByText("Patrol Pattern 017", { exact: true }),
  ).toBeVisible();

  await page.getByLabel("Поиск").fill("Pattern 029");
  await page.getByRole("button", { name: /Pattern 029/u }).click();
  await expect(
    page.getByText(/Этот учебный корпус недоступен для выбранного Battlefleet\./u),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Добавление недоступно" })).toBeDisabled();
});

test("creates, builds and reloads a Crown Vanguard fleet", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/rosters/new");
  await page.getByLabel("Название флота").fill("Crown Vanguard Squadron");
  await page.getByLabel("Фракция").selectOption("demo-crown");
  await page.locator('select[name="battlefleetId"]').selectOption("demo-crown-vanguard");
  await expect(page.getByRole("heading", { name: "Vanguard Exercise" })).toBeVisible();
  await page.getByRole("button", { name: "Создать и открыть состав" }).click();

  await expect(
    page.getByRole("heading", { level: 1, name: "Crown Vanguard Squadron" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Command Element" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Patrol Element" })).toBeVisible();
  await expect(page.getByText("112 учебных записей")).toBeVisible();

  await page.getByLabel("Поиск").fill("Akita Demonstrator");
  await page.getByRole("button", { name: /Akita Demonstrator/u }).click();
  await page.getByRole("button", { name: "Добавить в состав" }).click();
  await expect(page.getByText("350 / 1000")).toBeVisible();
  await expect(
    page.locator(".roster-instance-list").getByText("Akita Demonstrator", { exact: true }),
  ).toBeVisible();

  const savedId = page.url().split("/").pop()!;
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Crown Vanguard Squadron" }),
  ).toBeVisible();
  await expect(page.getByText("350 / 1000")).toBeVisible();
  expect(
    await page.evaluate((key) => window.localStorage.getItem(`dwb.roster.v1.${key}`), savedId),
  ).not.toBeNull();
});

test("keeps Composition fixed and switches only the tablet side pane", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/rosters/scaffold-demo");
  await expect(page.getByRole("heading", { level: 1, name: "Учебная эскадра" })).toBeVisible();

  const switcher = page.getByRole("navigation", { name: "Боковая область билдера" });
  await expect(switcher).toBeVisible();
  await expect(switcher.getByRole("button", { name: "Состав" })).toHaveCount(0);
  await expect(switcher.getByRole("button", { name: "Каталог" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".composition-pane")).toBeVisible();
  await expect(page.locator(".catalog-pane")).toBeVisible();
  await expect(page.locator(".context-pane")).toBeHidden();

  await switcher.getByRole("button", { name: "Контекст" }).click();
  await expect(switcher.getByRole("button", { name: "Контекст" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.locator(".composition-pane")).toBeVisible();
  await expect(page.locator(".catalog-pane")).toBeHidden();
  await expect(page.locator(".context-pane")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Область билдера", exact: true })).toBeHidden();
});

test("configures Akita 0/4 → 4/4, fixes fleet-level Kagutsuchi and retries a failed save", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/rosters/scaffold-demo");
  await page.getByLabel("Поиск").fill("Akita Demonstrator");
  await page.getByRole("button", { name: /Akita Demonstrator/u }).click();
  await expect(page.getByText("Только чтение")).toBeVisible();
  await expect(page.getByText("0 / 4")).toBeVisible();
  await page.getByRole("button", { name: "Добавить в состав" }).click();
  await expect(page.getByText("Редактирование")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Akita Demonstrator" })).toBeFocused();

  await page.getByRole("button", { name: "Настроить доктрину" }).click();
  await page.getByLabel("Количество Kagutsuchi Doctrine").fill("1");
  const requirement = page.getByRole("button", {
    name: /Kagutsuchi Doctrine requires Magma Cast Generator/u,
  });
  await expect(requirement).toBeVisible();
  await requirement.scrollIntoViewIfNeeded();
  await captureReviewEvidence(
    page,
    {
      route: "/rosters/scaffold-demo",
      state: "akita-kagutsuchi-requires-magma",
      viewport: { name: "desktop-1280x900", width: 1280, height: 900 },
    },
    path.resolve("artifacts/review-evidence/akita-conditional"),
    "desktop-1280x900",
  );
  await requirement.click();
  await expect(page.getByRole("group", { name: /PSA/u })).toBeFocused();
  await page.getByRole("radio", { name: /Magma Cast Generator/u }).check();
  await expect(requirement).toHaveCount(0);
  await page.getByRole("radio", { name: /Fury Generator/u }).check();
  await page.getByRole("radio", { name: /Rocket Battery/u }).check();
  await page.getByRole("radio", { name: /Shield Generator/u }).check();
  await expect(page.getByText("4 / 4")).toBeVisible();
  await page.getByLabel("Количество Repair Crane").fill("1");
  await captureReviewEvidence(
    page,
    {
      route: "/rosters/scaffold-demo",
      state: "akita-configured-4-of-4",
      viewport: { name: "desktop-1280x900", width: 1280, height: 900 },
    },
    path.resolve("artifacts/review-evidence/akita-configured"),
    "desktop-1280x900",
  );
  await expectEditorTouchTargets(page);

  await page.evaluate(() => {
    const runtime = window as unknown as {
      __setItemDescriptor: PropertyDescriptor | undefined;
    };
    runtime.__setItemDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem");
    Storage.prototype.setItem = () => {
      throw new Error("simulated quota failure");
    };
  });
  await page.getByLabel("Количество Tanuki Escort").fill("4");
  await expect(page.getByText("405 / 1000")).toBeVisible();
  await expect(page.getByText("Производные изменения каталога")).toBeVisible();
  await expect(page.getByText("Не удалось сохранить на устройстве")).toBeVisible();
  await captureReviewEvidence(
    page,
    {
      route: "/rosters/scaffold-demo",
      state: "akita-save-error",
      viewport: { name: "desktop-1280x900", width: 1280, height: 900 },
    },
    path.resolve("artifacts/review-evidence/akita-save-error"),
    "desktop-1280x900",
  );

  await page.evaluate(() => {
    const runtime = window as unknown as {
      __setItemDescriptor: PropertyDescriptor | undefined;
    };
    if (runtime.__setItemDescriptor)
      Object.defineProperty(Storage.prototype, "setItem", runtime.__setItemDescriptor);
  });
  await page.getByRole("button", { name: "Повторить" }).click();
  await expect(page.getByText("Не удалось сохранить на устройстве")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("405 / 1000")).toBeVisible();
  await page.getByRole("button", { name: "Настроить" }).click();
  await expect(page.getByLabel("Количество Tanuki Escort")).toHaveValue("4");
  await page.getByRole("tab", { name: "Профиль" }).click();
  await expect(page.getByText(/будет подключён в KAN-36/u)).toBeVisible();
});

test("returns exact focus on mobile and keeps editor chrome below the workspace switcher", async ({
  page,
}) => {
  const viewport = { name: "mobile-390x844", width: 390, height: 844 } as const;
  await page.setViewportSize(viewport);
  await page.goto("/rosters/scaffold-demo");
  const switcher = page.getByRole("navigation", { name: "Область билдера", exact: true });
  await switcher.getByRole("button", { name: "Каталог" }).click();
  await page.getByLabel("Поиск").fill("Akita Demonstrator");
  const origin = page.getByRole("button", { name: /Akita Demonstrator/u });
  await origin.click();
  await expect(page.getByRole("heading", { level: 3, name: "Akita Demonstrator" })).toBeFocused();

  const switcherBox = await switcher.boundingBox();
  const chromeBox = await page.locator(".ship-editor__chrome").boundingBox();
  expect(switcherBox).not.toBeNull();
  expect(chromeBox).not.toBeNull();
  expect(chromeBox!.y).toBeGreaterThanOrEqual(switcherBox!.y + switcherBox!.height - 1);

  await page.getByRole("button", { name: /Назад/u }).click();
  await expect(origin).toBeFocused();
  await origin.click();
  await page.getByRole("button", { name: "Добавить в состав" }).click();
  await page.getByRole("button", { name: "Настроить доктрину" }).click();
  await page.getByLabel("Количество Kagutsuchi Doctrine").fill("1");
  await expect(
    page.getByRole("button", { name: /Kagutsuchi Doctrine requires Magma Cast Generator/u }),
  ).toBeVisible();
  await captureReviewEvidence(
    page,
    { route: "/rosters/scaffold-demo", state: "akita-kagutsuchi-requires-magma", viewport },
    path.resolve("artifacts/review-evidence/akita-conditional"),
    viewport.name,
  );
  await page.getByRole("radio", { name: /Magma Cast Generator/u }).check();
  await page.getByRole("radio", { name: /Fury Generator/u }).check();
  await page.getByRole("radio", { name: /Rocket Battery/u }).check();
  await page.getByRole("radio", { name: /Shield Generator/u }).check();
  await captureReviewEvidence(
    page,
    { route: "/rosters/scaffold-demo", state: "akita-configured-4-of-4", viewport },
    path.resolve("artifacts/review-evidence/akita-configured"),
    viewport.name,
  );

  await page.evaluate(() => {
    const runtime = window as unknown as {
      __setItemDescriptor: PropertyDescriptor | undefined;
    };
    runtime.__setItemDescriptor = Object.getOwnPropertyDescriptor(Storage.prototype, "setItem");
    Storage.prototype.setItem = () => {
      throw new Error("simulated quota failure");
    };
  });
  await page.getByLabel("Количество Tanuki Escort").fill("4");
  await expect(page.getByText("Не удалось сохранить на устройстве")).toBeVisible();
  await captureReviewEvidence(
    page,
    { route: "/rosters/scaffold-demo", state: "akita-save-error", viewport },
    path.resolve("artifacts/review-evidence/akita-save-error"),
    viewport.name,
  );
  await page.evaluate(() => {
    const runtime = window as unknown as {
      __setItemDescriptor: PropertyDescriptor | undefined;
    };
    if (runtime.__setItemDescriptor)
      Object.defineProperty(Storage.prototype, "setItem", runtime.__setItemDescriptor);
  });
  await page.getByRole("button", { name: "Повторить" }).click();

  await expectEditorTouchTargets(page);

  await page.getByRole("button", { name: /Назад/u }).click();
  await switcher.getByRole("button", { name: "Состав" }).click();
  const editOrigin = page.getByRole("button", { name: "Настроить" });
  await editOrigin.click();
  await expect(page.getByRole("heading", { level: 3, name: "Akita Demonstrator" })).toBeFocused();
  await page.getByRole("button", { name: /Назад/u }).click();
  await expect(editOrigin).toBeFocused();
});

test("supports Arrow keys, Home and End in editor tabs", async ({ page }) => {
  await page.goto("/rosters/scaffold-demo");
  await page.getByLabel("Поиск").fill("Akita Demonstrator");
  await page.getByRole("button", { name: /Akita Demonstrator/u }).click();
  const configuration = page.getByRole("tab", { name: "Настройка" });
  await configuration.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "Профиль" })).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Правила" })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(configuration).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "Правила" })).toBeFocused();
});

test("has no serious or critical Axe violations in the builder reference state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/rosters/scaffold-demo");
  await expect(page.getByRole("heading", { level: 1, name: "Учебная эскадра" })).toBeVisible();
  await page.getByLabel("Поиск").fill("Akita Demonstrator");
  await page.getByRole("button", { name: /Akita Demonstrator/u }).click();
  await expect(page.getByText("Только чтение")).toBeVisible();
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const runtime = (
      window as unknown as {
        axe: {
          run(root: Document): Promise<{
            violations: Array<{ id: string; impact: string | null; help: string }>;
          }>;
        };
      }
    ).axe;
    const result = await runtime.run(document);
    return result.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
  });
  expect(violations).toEqual([]);
});

for (const scenario of [
  { name: "preview-mobile", configured: false, width: 390, height: 844 },
  { name: "configured-desktop", configured: true, width: 1280, height: 900 },
  { name: "configured-mobile", configured: true, width: 390, height: 844 },
] as const) {
  test(`has no serious or critical Axe violations in ${scenario.name}`, async ({ page }) => {
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.goto("/rosters/scaffold-demo");
    if (scenario.width <= 768)
      await page
        .getByRole("navigation", { name: "Область билдера", exact: true })
        .getByRole("button", { name: "Каталог" })
        .click();
    await page.getByLabel("Поиск").fill("Akita Demonstrator");
    await page.getByRole("button", { name: /Akita Demonstrator/u }).click();
    if (scenario.configured) {
      await page.getByRole("button", { name: "Добавить в состав" }).click();
      await page.getByRole("radio", { name: /Magma Cast Generator/u }).check();
      await page.getByRole("radio", { name: /Fury Generator/u }).check();
      await page.getByRole("radio", { name: /Rocket Battery/u }).check();
      await page.getByRole("radio", { name: /Shield Generator/u }).check();
      await expect(page.getByText("4 / 4")).toBeVisible();
    }
    await page.addScriptTag({ content: axe.source });
    expect(await seriousAxeViolations(page)).toEqual([]);
  });
}

async function seriousAxeViolations(page: Page) {
  return page.evaluate(async () => {
    const runtime = (
      window as unknown as {
        axe: {
          run(root: Document): Promise<{
            violations: Array<{ id: string; impact: string | null; help: string }>;
          }>;
        };
      }
    ).axe;
    const result = await runtime.run(document);
    return result.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
  });
}
