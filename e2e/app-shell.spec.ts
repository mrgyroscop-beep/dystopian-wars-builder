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
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    for (const element of document.querySelectorAll<HTMLElement>(
      ".context-pane, .ship-editor, .ship-editor__configuration",
    ))
      element.scrollTop = 0;
  });
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

async function chooseEditorOption(page: Page, groupName: RegExp, optionName: RegExp) {
  const group = page.getByRole("group", { name: groupName });
  const option = group.getByRole("radio", { name: optionName });

  if ((await option.count()) === 0) await group.locator(".editor-group__summary").click();
  await group.getByRole("radio", { name: optionName }).check();
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

test("configures the Akita baseline, fixes fleet-level Kagutsuchi and retries a failed save", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/rosters/scaffold-demo");
  await page.getByLabel("Поиск").fill("Akita Demonstrator");
  await page.getByRole("button", { name: /Akita Demonstrator/u }).click();
  await expect(page.getByText("Только чтение")).toBeVisible();
  await expect(page.getByText("4 / 4")).toBeVisible();
  await page.getByRole("button", { name: "Добавить в состав" }).click();
  await expect(page.getByText("Редактирование")).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "Akita Demonstrator" })).toBeFocused();
  const editorMarkup = await page.locator(".ship-editor").evaluate((element) => element.outerHTML);
  expect(editorMarkup).not.toMatch(/DEMO-|opaque|demo-akita-slot|:slot/iu);
  await expect(page.locator(".editor-problems li")).toHaveCount(0);

  await chooseEditorOption(page, /PSA/u, /Heavy Battery/u);

  await page.getByRole("button", { name: "Настроить доктрину" }).click();
  await page.getByLabel("Количество Kagutsuchi Doctrine").fill("1");
  const requirement = page.getByRole("button", {
    name: /Kagutsuchi Doctrine requires Magma Cast Generator/u,
  });
  await expect(requirement).toBeVisible();
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
  await chooseEditorOption(page, /PSA/u, /Magma Cast Generator/u);
  await expect(requirement).toHaveCount(0);
  await chooseEditorOption(page, /FPS 1/u, /Fury Generator/u);
  await chooseEditorOption(page, /FPS 2/u, /Rocket Battery/u);
  await chooseEditorOption(page, /FPS 3/u, /Shield Generator/u);
  await expect(page.getByText("4 / 4")).toBeVisible();
  await expect(page.locator(".editor-problems li")).toHaveCount(0);
  await page.getByLabel("Количество Repair Crane").fill("1");
  await expect(page.getByText("375 / 1000")).toBeVisible();
  await expect(page.locator(".roster-instance-list small")).toHaveText("375 Points · 9 VP");
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
  await expect(page.locator(".roster-instance-list small")).toHaveText("405 Points · 9 VP");
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
  await expect(page.getByText("Эффективный профиль")).toBeVisible();
  await expect(page.getByText("PSA", { exact: true })).toBeVisible();
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
  await chooseEditorOption(page, /PSA/u, /Heavy Battery/u);
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
  await chooseEditorOption(page, /PSA/u, /Magma Cast Generator/u);
  await chooseEditorOption(page, /FPS 1/u, /Fury Generator/u);
  await chooseEditorOption(page, /FPS 2/u, /Rocket Battery/u);
  await chooseEditorOption(page, /FPS 3/u, /Shield Generator/u);
  await page.getByLabel("Количество Repair Crane").fill("1");
  await expect(page.getByText("375 / 1000")).toBeVisible();
  await expect(page.locator(".roster-instance-list small")).toHaveText("375 Points · 9 VP");
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
  await expect(page.getByText("405 / 1000")).toBeVisible();
  await expect(page.locator(".roster-instance-list small")).toHaveText("405 Points · 9 VP");
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

test("keeps the editable mobile chrome within thirty percent of the viewport", async ({ page }) => {
  const viewport = { width: 390, height: 844 } as const;
  await page.setViewportSize(viewport);
  await page.goto("/rosters/scaffold-demo");
  const switcher = page.getByRole("navigation", { name: "Область билдера", exact: true });
  await switcher.getByRole("button", { name: "Каталог" }).click();
  await page.getByLabel("Поиск").fill("Akita Demonstrator");
  await page.getByRole("button", { name: /Akita Demonstrator/u }).click();
  await page.getByRole("button", { name: "Добавить в состав" }).click();
  await expect(page.getByText("Редактирование")).toBeAttached();

  const fixedHeight = await page.evaluate(() => {
    const switcherBox = document
      .querySelector<HTMLElement>(".workspace-view-switcher--mobile")
      ?.getBoundingClientRect();
    const chromeBox = document
      .querySelector<HTMLElement>(".ship-editor__chrome")
      ?.getBoundingClientRect();
    return (switcherBox?.height ?? 0) + (chromeBox?.height ?? 0);
  });

  expect(fixedHeight).toBeLessThanOrEqual(viewport.height * 0.3);
});

test("keeps the generated profile on the eye and opens ORBAT separately", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/rosters/scaffold-demo");
  const switcher = page.getByRole("navigation", { name: "Область билдера", exact: true });
  await switcher.getByRole("button", { name: "Каталог" }).click();
  await page.getByLabel("Поиск").fill("Akita Demonstrator");
  await page.getByRole("button", { name: "Показать профиль Akita Demonstrator" }).click();

  const dialog = page.getByRole("dialog", { name: "Akita Demonstrator" });
  const viewport = page.getByRole("region", { name: "Профиль корабля" });
  await expect(dialog).toHaveAttribute("data-card-view", "profile");
  await expect(
    page.getByRole("article", { name: "Мобильный профиль Akita Demonstrator" }),
  ).toBeVisible();
  const mobile = await viewport.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.clientWidth + 1);

  await page.getByRole("button", { name: "Закрыть профиль" }).click();
  await page.setViewportSize({ width: 1380, height: 960 });
  await page.getByRole("button", { name: "Показать страницу ORBAT Akita Demonstrator" }).click();
  const orbatDialog = page.getByRole("dialog", { name: "Akita Demonstrator" });
  const orbatPage = orbatDialog.getByRole("img", {
    name: /Полная страница ORBAT для Akita Demonstrator/u,
  });
  await expect(orbatPage).toBeVisible();
  await expect(orbatPage).toHaveAttribute("src", "/orbat-cards/empire/23.webp");
  await orbatPage.evaluate((image) => {
    if (image instanceof HTMLImageElement && !image.complete)
      return new Promise<void>((resolve) =>
        image.addEventListener("load", () => resolve(), { once: true }),
      );
  });

  const orbatViewport = orbatDialog.getByRole("region", { name: "Профиль корабля" });
  await orbatViewport.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  const close = orbatDialog.getByRole("button", { name: "Закрыть страницу ORBAT" });
  const closeMetrics = await close.evaluate((button) => {
    const dialog = button.closest("dialog");
    const viewport = dialog?.querySelector<HTMLElement>(".profile-dialog__content");
    const icon = button.querySelector<SVGElement>(".profile-dialog__close-icon");
    const buttonBox = button.getBoundingClientRect();
    const iconBox = icon?.getBoundingClientRect();
    return {
      dialogScrollTop: dialog?.scrollTop ?? -1,
      dialogScrolls: (dialog?.scrollHeight ?? 0) !== (dialog?.clientHeight ?? 0),
      viewportScrollTop: viewport?.scrollTop ?? -1,
      centerOffsetX: iconBox
        ? Math.abs(buttonBox.left + buttonBox.width / 2 - (iconBox.left + iconBox.width / 2))
        : 99,
      centerOffsetY: iconBox
        ? Math.abs(buttonBox.top + buttonBox.height / 2 - (iconBox.top + iconBox.height / 2))
        : 99,
    };
  });
  expect(closeMetrics.dialogScrollTop).toBe(0);
  expect(closeMetrics.dialogScrolls).toBe(false);
  expect(closeMetrics.viewportScrollTop).toBeGreaterThan(0);
  expect(closeMetrics.centerOffsetX).toBeLessThanOrEqual(0.5);
  expect(closeMetrics.centerOffsetY).toBeLessThanOrEqual(0.5);
  await close.click();
  await expect(orbatDialog).toHaveCount(0);
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

test("shows preview/configured profiles and returns from stable-ID rule navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/rosters/scaffold-demo");
  await page.getByLabel("Поиск").fill("Akita Demonstrator");
  await page.getByRole("button", { name: /Akita Demonstrator/u }).click();
  await page.getByRole("tab", { name: "Профиль" }).click();
  await expect(page.getByText("Базовый профиль")).toBeVisible();
  await expect(page.locator(".weapon-table tbody tr")).toHaveCount(1);
  await expect(page.getByRole("row", { name: /Fore Battery/u })).toContainText("Torrent");
  await captureReviewEvidence(
    page,
    {
      route: "/rosters/scaffold-demo",
      state: "akita-preview-profile",
      viewport: { name: "desktop-1440x1000", width: 1440, height: 1000 },
    },
    path.resolve("artifacts/review-evidence/akita-profile"),
    "desktop-1440x1000",
  );

  await page.getByRole("tab", { name: "Настройка" }).click();
  await page.getByRole("button", { name: "Добавить в состав" }).click();
  await chooseEditorOption(page, /PSA/u, /Heavy Battery/u);
  await page.getByRole("tab", { name: "Профиль" }).click();
  await expect(page.getByText("Эффективный профиль")).toBeVisible();
  await expect(page.getByRole("row", { name: /Heavy Battery/u })).toContainText("PSA");

  await page.setViewportSize({ width: 1440, height: 450 });
  await page.getByRole("tab", { name: "Правила" }).click();
  const contextPane = page.locator(".context-pane");
  const editorScroll = await contextPane.evaluate((element) => {
    element.scrollTop = Math.min(80, element.scrollHeight - element.clientHeight);
    return element.scrollTop;
  });
  expect(editorScroll).toBeGreaterThan(0);
  const origin = page.getByRole("button", { name: "Открыть правило Torrent" });
  await origin.evaluate((element) => element.focus({ preventScroll: true }));
  await origin.press("Enter");
  await contextPane.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(page).toHaveURL(/rule=synthetic-rule-torrent/u);
  await expect(page.getByRole("heading", { name: "Torrent" })).toBeFocused();
  const backToRules = page.getByRole("button", { name: /К правилам/u });
  await backToRules.evaluate((element) => element.focus({ preventScroll: true }));
  await backToRules.press("Enter");
  await expect(page.getByRole("button", { name: "Открыть правило Torrent" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "Правила" })).toHaveAttribute("aria-selected", "true");
  await expect.poll(() => contextPane.evaluate((element) => element.scrollTop)).toBe(editorScroll);

  const glossary = page.getByRole("button", { name: "Глоссарий" });
  await page.setViewportSize({ width: 1440, height: 180 });
  await glossary.evaluate((element) => element.focus({ preventScroll: true }));
  await glossary.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Глоссарий" });
  await expect(dialog).toBeVisible();
  const glossaryScroll = await dialog.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  expect(glossaryScroll).toBeGreaterThan(0);
  const glossaryItem = dialog.getByRole("button", { name: /Torrent/u });
  await glossaryItem.evaluate((element) => element.focus({ preventScroll: true }));
  await glossaryItem.press("Enter");
  await expect(page.getByRole("heading", { name: "Torrent" })).toBeFocused();
  await backToRules.evaluate((element) => element.focus({ preventScroll: true }));
  await backToRules.press("Enter");
  await expect(dialog).toBeVisible();
  await expect(glossaryItem).toBeFocused();
  await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBe(glossaryScroll);
  await page.keyboard.press("Escape");
  await expect(glossary).toBeFocused();
});

for (const viewport of [
  { name: "desktop-1440", width: 1440, height: 1000 },
  { name: "tablet-1024", width: 1024, height: 900 },
  { name: "boundary-600", width: 600, height: 900 },
  { name: "cards-599", width: 599, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
] as const) {
  test(`keeps equivalent profile data without overflow at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/rosters/scaffold-demo?ship=demo-ship-001&shipMode=preview");
    const heading = page.getByRole("heading", { level: 3, name: "Akita Demonstrator" });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await page.getByRole("tab", { name: "Профиль" }).click();
    if (viewport.width < 600) {
      await expect(page.locator(".weapon-table-wrap")).toBeHidden();
      await expect(page.locator(".weapon-card")).toHaveCount(1);
      await expect(page.locator(".weapon-card")).toContainText("Fore Battery");
      await expect(page.locator(".weapon-card")).toContainText("Torrent");
    } else {
      await expect(page.locator(".weapon-cards")).toBeHidden();
      await expect(page.locator(".weapon-table tbody tr")).toHaveCount(1);
      await expect(page.getByRole("row", { name: /Fore Battery/u })).toContainText("Torrent");
    }
    const overflow = await page.evaluate(() => ({
      document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      editor:
        (document.querySelector(".ship-editor")?.scrollWidth ?? 0) -
        (document.querySelector(".ship-editor")?.clientWidth ?? 0),
    }));
    expect(overflow.document).toBeLessThanOrEqual(0);
    expect(overflow.editor).toBeLessThanOrEqual(0);
  });
}

test("keeps profile reflow and Axe serious-critical zero at 200% text zoom", async ({ page }) => {
  // A 512 CSS-pixel viewport represents a 1024px browser viewport at 200% page zoom.
  await page.setViewportSize({ width: 512, height: 900 });
  await page.goto("/rosters/scaffold-demo?ship=demo-ship-001&shipMode=preview");
  await page.getByRole("tab", { name: "Профиль" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
  await page.getByRole("tab", { name: "Правила" }).click();
  await page.getByRole("button", { name: "Глоссарий" }).click();
  await page.addScriptTag({ content: axe.source });
  expect(await seriousAxeViolations(page)).toEqual([]);
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
