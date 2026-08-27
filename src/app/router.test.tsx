import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HealthGateway } from "../application/health/health-contract";
import type { FeedbackGateway } from "../application/feedback/feedback-contract";
import type { StoredRoster } from "../application/rosters/create-roster";
import {
  createDemonstrationFleetCatalogGateway,
  createDemonstrationWorkspaceRoster,
} from "../infrastructure/catalog/demonstration-fleet-catalog";
import { createAppRoutes } from "./router";
import { BATTLE_SHIP_COUNTERS_STORAGE_KEY } from "./battleDisplayPreferences";

const readHealth = vi.fn<HealthGateway["read"]>().mockResolvedValue({
  status: "ok",
  environment: "local",
  appVersion: "test-version",
  catalogVersion: "test-catalog",
  commitSha: "0000000000000000000000000000000000000000",
});
const submitFeedback = vi.fn<FeedbackGateway["submit"]>().mockResolvedValue({
  id: "fb_12345678-1234-4123-8123-123456789abc",
  duplicate: false,
});

const storedRosters = new Map<string, StoredRoster>();
const rosterRepository = {
  contractVersion: 1 as const,
  save: vi.fn((roster: StoredRoster) => {
    storedRosters.set(roster.id, roster);
    return Promise.resolve();
  }),
  read: vi.fn((id: string) => Promise.resolve(storedRosters.get(id) ?? null)),
  remove: vi.fn((id: string) => {
    storedRosters.delete(id);
    return Promise.resolve();
  }),
};
const syncRepository = {
  ...rosterRepository,
  list: () => Promise.resolve([...storedRosters.values()]),
  syncNow: () =>
    Promise.resolve({ uploaded: 0, downloaded: 0, conflicts: 0, authenticated: false }),
};
const rosterCreation = {
  setupGateway: {
    contractVersion: 1 as const,
    load: () =>
      Promise.resolve({
        contractVersion: 1 as const,
        contentVersion: "demonstration-1",
        mode: "current" as const,
        notice: null,
        factions: [
          {
            id: "demo-empire",
            label: "Empire",
            battlefleets: [
              {
                id: "demo-empire-patrol",
                factionId: "demo-empire",
                label: "Patrol Fleet",
                summary: "A test Battlefleet.",
                requiredElements: [
                  { id: "demo-flagship", label: "Flagship Element", minimum: 1 },
                  { id: "demo-line", label: "Line Element", minimum: 1 },
                ],
              },
            ],
          },
        ],
      }),
  },
  rosterRepository,
  createId: () => "created-roster",
  now: () => "2026-08-02T10:00:00.000Z",
};

afterEach(() => {
  cleanup();
  window.localStorage.removeItem("dwb-rule-language");
  window.localStorage.removeItem(BATTLE_SHIP_COUNTERS_STORAGE_KEY);
  storedRosters.clear();
  rosterRepository.save.mockClear();
});
const testDependencies = {
  authGateway: {
    contractVersion: 1 as const,
    session: () => Promise.resolve(null),
    register: () => Promise.reject(new Error("not used")),
    login: () => Promise.reject(new Error("not used")),
    logout: () => Promise.resolve(),
    deleteAccount: () => Promise.resolve(),
  },
  battleGateway: {
    contractVersion: 1 as const,
    create: () => Promise.reject(new Error("not used")),
    join: () => Promise.reject(new Error("not used")),
    read: () => Promise.reject(new Error("not used")),
    update: () => Promise.reject(new Error("not used")),
    leave: () => Promise.resolve(),
  },
  assistantGateway: {
    contractVersion: 1 as const,
    ask: () => Promise.reject(new Error("not used")),
  },
  feedbackGateway: { contractVersion: 1 as const, submit: submitFeedback },
  glossaryGateway: {
    contractVersion: 1 as const,
    list: () =>
      Promise.resolve([
        {
          id: "R1",
          title: "All Around",
          text: "The weapon can contribute from every arc.",
          factions: ["Empire"],
          page: 26,
          translation: {
            id: "R1",
            language: "ru" as const,
            sourceTitle: "All Around",
            title: "Круговой огонь",
            text: "Оружие может участвовать в атаке из любой огневой дуги.",
          },
        },
        {
          id: "R2",
          title: "Torrent",
          text: "Resolve several attacks as one torrent.",
          factions: ["Empire", "Union"],
          page: 32,
          translation: {
            id: "R2",
            language: "ru" as const,
            sourceTitle: "Torrent",
            title: "Шквал",
            text: "Проведите несколько атак как один шквал.",
          },
        },
        {
          id: "R3",
          title: "Kagutsuchi Doctrine",
          text: "Ships receive one coordinated admiral order.",
          factions: ["Empire"],
          page: null,
          translation: {
            id: "R3",
            language: "ru" as const,
            sourceTitle: "Kagutsuchi Doctrine",
            title: "Доктрина Кагуцути",
            text: "Корабли получают единый оперативный приказ адмирала.",
          },
        },
      ]),
  },
  healthGateway: { read: readHealth } satisfies HealthGateway,
  rosterCreation,
  rosterLibrary: {
    rosterRepository: syncRepository,
    createId: () => crypto.randomUUID(),
    now: () => "2026-08-02T10:00:00.000Z",
  },
  shipLibrary: {
    setupGateway: rosterCreation.setupGateway,
    catalogGateway: createDemonstrationFleetCatalogGateway(),
  },
  rosterWorkspace: {
    setupGateway: rosterCreation.setupGateway,
    catalogGateway: createDemonstrationFleetCatalogGateway(),
    rosterRepository,
    createId: () => crypto.randomUUID(),
    now: () => "2026-08-02T10:00:00.000Z",
    fallbackRoster: (id: string) =>
      id === "scaffold-demo" ? createDemonstrationWorkspaceRoster(id) : null,
  },
  rosterSync: syncRepository,
};

function renderRoute(path: string) {
  const testRouter = createMemoryRouter(createAppRoutes(testDependencies), {
    initialEntries: [path],
  });
  return { ...render(<RouterProvider router={testRouter} />), router: testRouter };
}

describe("application routes", () => {
  it("renders semantic landmarks, one h1 and the current navigation item", async () => {
    renderRoute("/");

    expect(screen.getByRole("banner")).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
    expect(screen.getByRole("main")).toBeVisible();
    expect(screen.getByRole("contentinfo")).toHaveTextContent(
      "Dystopian Wars 4.0 · версия 0.2.15 · локальные флоты доступны без регистрации",
    );
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Флоты" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Создать" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Войти в аккаунт" })).toHaveTextContent("Войти");
    await waitFor(() => expect(document.title).toContain("Флоты"));
  });

  it("switches the rules language from the site header", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/");

    const language = screen.getByRole("group", { name: "Язык правил" });
    expect(language).toBeVisible();
    expect(within(language).getByRole("button", { name: "RU" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(within(language).getByRole("button", { name: "EN" }));

    expect(within(language).getByRole("button", { name: "EN" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(window.localStorage.getItem("dwb-rule-language")).toBe("en");
  });

  it("requires confirmation before deleting a saved roster", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const saved = createDemonstrationWorkspaceRoster("delete-me");
    storedRosters.set(saved.id, saved);
    rosterRepository.remove.mockClear();
    renderRoute("/");

    expect(await screen.findByRole("heading", { name: saved.name })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Удалить" }));
    expect(rosterRepository.remove).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Удалить флот" }));

    await waitFor(() => expect(rosterRepository.remove).toHaveBeenCalledWith(saved.id));
    expect(screen.queryByRole("heading", { name: saved.name })).not.toBeInTheDocument();
  });

  it("opens the ship encyclopedia from the fleet library and exposes profile and ORBAT icons", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/");

    await user.click(screen.getByRole("link", { name: "Просмотреть корабли" }));
    expect(await screen.findByRole("heading", { name: "Выберите фракцию" })).toBeVisible();
    const empireLink = screen.getByRole("link", { name: /Empire/u });
    expect(empireLink.querySelector(".faction-emblem")).toHaveStyle({
      backgroundImage: 'url("/orbat-templates/empire.webp")',
    });
    await user.click(empireLink);

    expect(await screen.findByRole("heading", { name: "Корабли Empire" })).toBeVisible();
    expect(document.querySelector(".ship-catalog-heading .faction-emblem")).toHaveStyle({
      backgroundImage: 'url("/orbat-templates/empire.webp")',
    });
    expect(
      screen.getByRole("button", { name: "Показать профиль Akita Demonstrator" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Показать страницу ORBAT Akita Demonstrator" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Цена")).toHaveValue("ascending");

    await user.click(screen.getByRole("button", { name: "Показать профиль Akita Demonstrator" }));
    expect(await screen.findByRole("dialog", { name: "Akita Demonstrator" })).toBeVisible();
  });

  it("shows the saved roster faction emblem", async () => {
    const saved = createDemonstrationWorkspaceRoster("with-faction-emblem");
    storedRosters.set(saved.id, saved);
    const { container } = renderRoute("/");

    expect(await screen.findByRole("heading", { name: saved.name })).toBeVisible();
    expect(container.querySelector(".roster-card__faction-emblem")).toHaveStyle({
      backgroundImage: 'url("/orbat-templates/empire.webp")',
    });
  });

  it("shows the authenticated user name after settings", async () => {
    const authGateway = {
      ...testDependencies.authGateway,
      session: () =>
        Promise.resolve({ id: "12345678-1234-4123-8123-123456789abc", displayName: "Адмирал" }),
    };
    const testRouter = createMemoryRouter(createAppRoutes({ ...testDependencies, authGateway }), {
      initialEntries: ["/"],
    });
    render(<RouterProvider router={testRouter} />);

    expect(await screen.findByRole("link", { name: "Аккаунт: Адмирал" })).toHaveTextContent(
      "Адмирал",
    );
  });

  it("renders a controlled 404 with a recovery action", () => {
    renderRoute("/route-that-does-not-exist");

    expect(screen.getByRole("heading", { level: 1, name: "Такого маршрута нет" })).toBeVisible();
    expect(screen.getByRole("link", { name: "К моим флотам" })).toHaveAttribute("href", "/");
  });

  it("opens the rules and ORBAT library and filters its official sources", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/reference");

    expect(screen.getByRole("heading", { level: 1, name: "Правила и ORBATs" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Правила" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Найдено материалов: 11")).toBeVisible();
    await user.click(screen.getAllByRole("button", { name: /Читать внутри/u })[0]!);
    expect(screen.getByRole("region", { name: "Правила 4.00" })).toHaveAttribute(
      "data-source",
      "/reference-pdf/rules-4-00",
    );
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    await user.click(screen.getByRole("button", { name: "ORBATS" }));
    expect(screen.getByText("Найдено материалов: 8")).toBeVisible();
    await user.type(screen.getByLabelText("Поиск по библиотеке"), "Empire");
    expect(screen.getByText("Найдено материалов: 1")).toBeVisible();
    expect(screen.getByRole("link", { name: /Открыть раздел/u })).toHaveAttribute(
      "href",
      "https://www.dystopianwars.com/factions/empire",
    );
    await user.click(screen.getByRole("button", { name: /Открыть ORBAT/u }));
    expect(screen.getByRole("region", { name: "Empire" })).toHaveAttribute(
      "data-source",
      "/reference-pdf/orbat-empire",
    );
  });

  it("asks the user to sign in before opening the rules assistant", async () => {
    renderRoute("/assistant");

    expect(await screen.findByRole("heading", { level: 2, name: "Старпом" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Старпом" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Спросить Старпома" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Войти или создать аккаунт" })).toHaveAttribute(
      "href",
      "/settings#account-title",
    );
  });

  it("opens a searchable bilingual text glossary", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/reference?view=glossary");

    expect(await screen.findByRole("heading", { name: "Глоссарий правил" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Текстовый глоссарий" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(await screen.findByRole("heading", { name: "Круговой огонь" })).toBeVisible();
    expect(
      screen.getByText("Оружие может участвовать в атаке из любой огневой дуги."),
    ).toBeVisible();

    const glossaryLanguage = screen.getAllByRole("group", { name: "Язык правил" })[1]!;
    await user.click(within(glossaryLanguage).getByRole("button", { name: "EN" }));
    expect(screen.getByRole("heading", { name: "All Around" })).toBeVisible();
    expect(screen.getByText("The weapon can contribute from every arc.")).toBeVisible();

    await user.type(screen.getByRole("searchbox"), "Torrent");
    expect(screen.getByText("Найдено: 1")).toBeVisible();
    expect(screen.getByRole("button", { name: /Torrent/u })).toBeVisible();
  });

  it("opens a selected campaign act and switches between its mission and fixed fleets", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/campaign/act-4/mission");

    expect(screen.getByRole("heading", { level: 1, name: "Dominion of the Dragon" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Кампания" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /Акт 4/u })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("link", { name: "Миссия" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("img", { name: /Схема расстановки/u })).toBeVisible();
    expect(screen.getByText("Запас Хранителя Короны — 8 кубиков")).toBeVisible();

    await user.click(screen.getByRole("link", { name: "Флот Короны" }));

    expect(await screen.findByRole("heading", { name: "HMIS Strikakulam" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Флот Короны" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByText("6")).toBeVisible();

    const imageButton = screen.getByRole("button", {
      name: "Открыть увеличенное изображение HMIS Strikakulam",
    });
    expect(
      within(imageButton).getByRole("img", { name: "Sabre Command Cruiser HMIS Strikakulam" }),
    ).toBeVisible();

    await user.click(imageButton);
    const imageDialog = await screen.findByRole("dialog", { name: "HMIS Strikakulam" });
    expect(
      within(imageDialog).getByRole("img", {
        name: "Увеличенное изображение HMIS Strikakulam",
      }),
    ).toHaveAttribute("src", "/campaign/ships/hmis-strikakulam.webp");

    await user.click(
      within(imageDialog).getByRole("button", { name: "Закрыть изображение корабля" }),
    );
    expect(imageButton).toHaveFocus();
  });

  it("keeps campaign traits clickable in the fleet and detailed profile", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/campaign/act-4/crown");

    const shipHeading = await screen.findByRole("heading", { name: "HMIS Strikakulam" });
    const shipCard = shipHeading.closest("li");
    expect(shipCard).not.toBeNull();

    await user.click(within(shipCard!).getByRole("button", { name: /Охотник|Hunter/u }));
    expect(await screen.findByRole("dialog", { name: "Охотник" })).toHaveTextContent(
      "активный адмирал может перебросить",
    );
    await user.click(screen.getByRole("button", { name: "Закрыть описание правила" }));

    await user.click(within(shipCard!).getByRole("button", { name: "Профиль" }));
    expect(await screen.findByRole("dialog", { name: "HMIS Strikakulam" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Профиль корабля" })).toHaveTextContent(
      "Torpedo Salvo",
    );

    const guardianButtons = screen.getAllByRole("button", {
      name: /Генератор-хранитель|Guardian Generator/u,
    });
    await user.click(guardianButtons[0]!);
    expect(await screen.findByRole("dialog", { name: "Генератор-хранитель" })).toHaveTextContent(
      "запасом Хранителя",
    );
  });

  it("renders a deep roster route without loading the library first", async () => {
    const { container } = renderRoute("/rosters/scaffold-demo");

    expect(await screen.findByRole("heading", { level: 1, name: "Учебная эскадра" })).toBeVisible();
    expect(container.querySelector(".app-shell--workspace")).toBeInTheDocument();
    expect(container.querySelector(".main-content--workspace")).toBeInTheDocument();
    expect(container.querySelector(".site-footer")).not.toBeInTheDocument();
    const commandStrip = container.querySelector<HTMLElement>(".workspace-command-strip");
    expect(commandStrip).not.toBeNull();
    const command = within(commandStrip!);
    expect(command.getByText("Empire")).toBeVisible();
    expect(command.getByRole("heading", { level: 1, name: "Учебная эскадра" })).toBeVisible();
    expect(command.getByText("Points")).toBeVisible();
    expect(command.getByText("0 / 1000")).toBeVisible();
    expect(command.getByText("VPR")).toBeVisible();
    expect(command.getByRole("combobox", { name: "Battlefleet" })).toHaveValue(
      "demo-empire-patrol",
    );
    expect(command.queryByText("Состав")).not.toBeInTheDocument();
    expect(command.queryByText("Сохранение")).not.toBeInTheDocument();
    expect(command.queryByText("Система")).not.toBeInTheDocument();
    expect(command.queryByText("Новый флот")).not.toBeInTheDocument();
    expect(command.queryByText(/пересчитаются автоматически/u)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Новый флот" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Состав" })).toBeVisible();
    expect(screen.getByText("0 выбрано · 1 мин. · 3 макс.")).toHaveAttribute(
      "aria-label",
      "Выбрано 0, минимум 1, максимум 3",
    );
    expect(screen.getByText("0 выбрано · 1 мин. · 6 макс.")).toHaveAttribute(
      "aria-label",
      "Выбрано 0, минимум 1, максимум 6",
    );
  });

  it("enables explicit save for a renamed fleet and persists only after the click", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/rosters/scaffold-demo");

    const name = await screen.findByRole("textbox", { name: "Название флота" });
    const save = screen.getByRole("button", { name: "Сохранить" });
    expect(name).toHaveValue("Учебная эскадра");
    expect(save).toBeDisabled();
    expect(rosterRepository.save).toHaveBeenCalledTimes(1);

    await user.clear(name);
    await user.type(name, "Северный дозор");

    expect(save).toBeEnabled();
    expect(rosterRepository.save).toHaveBeenCalledTimes(1);
    await user.click(save);

    await waitFor(() => expect(save).toBeDisabled());
    expect(rosterRepository.save).toHaveBeenCalledTimes(2);
    expect(storedRosters.get("scaffold-demo")?.name).toBe("Северный дозор");
  });

  it("warns before leaving a fleet with unsaved changes", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const { router } = renderRoute("/rosters/scaffold-demo");
    const name = await screen.findByRole("textbox", { name: "Название флота" });

    await user.type(name, " — черновик");
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    await router.navigate("/");
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith("Есть несохранённые изменения. Выйти без сохранения?"),
    );
    expect(router.state.location.pathname).toBe("/rosters/scaffold-demo");
    confirm.mockRestore();
  });

  it("keeps roster errors in composition as accessible section controls", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/rosters/scaffold-demo");

    const issues = await screen.findAllByRole("button", {
      name: /Открыть ошибки раздела/u,
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(screen.queryByText("Нужен корабль")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Проблемы состава" })).not.toBeInTheDocument();

    const firstIssue = issues[0]!;
    expect(firstIssue).toHaveAttribute("aria-expanded", "false");
    await user.click(firstIssue);
    expect(firstIssue).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(firstIssue.getAttribute("aria-controls")!)).toBeVisible();
  });

  it("shows doctrine as the first accordion in composition and opens its description", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const { container } = renderRoute("/rosters/scaffold-demo");

    const toggle = await screen.findByRole("button", { name: /Доктрина флота.*Не выбрана/u });
    const doctrine = container.querySelector(".fleet-doctrine")!;
    const firstFleetElement = container.querySelector(".fleet-element")!;
    expect(
      doctrine.compareDocumentPosition(firstFleetElement) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const option = await screen.findByRole("radio", { name: "Доктрина Кагуцути" });
    expect(option).not.toBeChecked();

    await user.click(
      screen.getByRole("button", { name: "Показать описание доктрины Доктрина Кагуцути" }),
    );
    expect(await screen.findByRole("dialog", { name: "Доктрина Кагуцути" })).toHaveTextContent(
      "Корабли получают единый оперативный приказ адмирала.",
    );
    const closeDescription = screen.getByRole("button", { name: "Закрыть описание доктрины" });
    expect(closeDescription).toHaveFocus();
    await user.tab();
    expect(closeDescription).toHaveFocus();
    await user.click(closeDescription);

    await user.click(option);
    expect(await screen.findByRole("radio", { name: "Доктрина Кагуцути" })).toBeChecked();
    expect(toggle).toHaveAccessibleName(/Доктрина флота.*Доктрина Кагуцути/u);
  });

  it("uses compact icon actions with accessible names for roster ships", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/rosters/scaffold-demo");

    const catalogShipName = await screen.findByText("Akita Demonstrator");
    const catalogShipButton = catalogShipName.closest("button");
    expect(catalogShipButton).not.toBeNull();
    await user.click(catalogShipButton!);
    await user.click(screen.getByRole("button", { name: "Добавить в состав" }));

    expect(
      await screen.findByRole("button", { name: "Открыть настройки Akita Demonstrator" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Копировать Akita Demonstrator" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Удалить Akita Demonstrator" })).toBeVisible();
    const profileButtons = screen.getAllByRole("button", {
      name: "Показать профиль Akita Demonstrator",
    });
    expect(profileButtons).toHaveLength(2);
    const orbatButtons = screen.getAllByRole("button", {
      name: "Показать страницу ORBAT Akita Demonstrator",
    });
    expect(orbatButtons).toHaveLength(2);
    await user.click(profileButtons[1]!);
    const profile = await screen.findByRole("dialog", { name: "Akita Demonstrator" });
    expect(
      within(profile).getByRole("article", { name: "Карточка Akita Demonstrator" }),
    ).toBeInTheDocument();
    const imageSearchLink = within(profile).getByRole("link", {
      name: "Найти изображения Akita Demonstrator в Google",
    });
    expect(imageSearchLink).toHaveAttribute(
      "href",
      "https://www.google.com/search?q=Akita+Demonstrator+Dystopian+Wars&tbm=isch",
    );
    expect(imageSearchLink).toHaveAttribute("target", "_blank");
    expect(imageSearchLink).toHaveAttribute("rel", "noopener noreferrer");
    await user.click(within(profile).getByRole("button", { name: "Закрыть профиль" }));

    await user.click(orbatButtons[1]!);
    const orbatPage = await screen.findByRole("img", {
      name: /Полная страница ORBAT для Akita Demonstrator/u,
    });
    expect(orbatPage).toHaveAttribute("src", "/orbat-cards/empire/23.webp");
  });

  it("quick-adds an eligible catalog ship and opens its options", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/rosters/scaffold-demo");

    await user.click(
      await screen.findByRole("button", { name: "Добавить Akita Demonstrator в состав" }),
    );

    expect(await screen.findByRole("region", { name: "Настройка корабля" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Akita Demonstrator" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Назад" }));
    expect(
      await screen.findByRole("button", { name: "Открыть настройки Akita Demonstrator" }),
    ).toBeVisible();
  });

  it("opens options from the ship row and keeps add action until the section is full", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/rosters/scaffold-demo");

    await user.click(
      await screen.findByRole("button", { name: "Добавить Akita Demonstrator в состав" }),
    );
    await user.click(screen.getByRole("button", { name: "Назад" }));
    const row = await screen.findByRole("button", {
      name: "Открыть настройки Akita Demonstrator",
    });
    await user.click(row);

    expect(await screen.findByRole("region", { name: "Настройка корабля" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Назад" }));
    expect(
      screen.getByRole("button", { name: "Добавить подходящий корабль в Flagship Element" }),
    ).toBeVisible();
  });

  it("marks a fleet element when its maximum ship count is exceeded", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/rosters/scaffold-demo");

    const catalogShipName = await screen.findByText("Akita Demonstrator");
    await user.click(catalogShipName.closest("button")!);
    await user.click(screen.getByRole("button", { name: "Добавить в состав" }));
    for (let copy = 0; copy < 3; copy += 1) {
      await user.click(
        screen.getAllByRole("button", { name: "Копировать Akita Demonstrator" })[0]!,
      );
    }

    const exceededLimit = await screen.findByLabelText(
      "Лимит превышен. Выбрано 4, минимум 1, максимум 3",
    );
    expect(exceededLimit).toHaveTextContent("! 4 выбрано · 1 мин. · 3 макс.");
    expect(exceededLimit).toHaveAttribute("data-state", "exceeded");
    expect(exceededLimit).toHaveAttribute(
      "aria-label",
      "Лимит превышен. Выбрано 4, минимум 1, максимум 3",
    );
    const issue = screen.getByRole("button", { name: /Открыть ошибки раздела Flagship Element/u });
    expect(issue).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Превышен лимит")).not.toBeInTheDocument();
    await user.click(issue);
    expect(issue).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(issue.getAttribute("aria-controls")!)).toHaveTextContent(
      /лимит/u,
    );

    const compositionIssue = screen.getByRole("button", {
      name: /Открыть общие ошибки состава/u,
    });
    await user.click(compositionIssue);
    expect(compositionIssue).toHaveFocus();
    expect(document.getElementById(compositionIssue.getAttribute("aria-controls")!)).toBeVisible();
  });

  it("opens the compatible catalog category from an empty fleet element", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/rosters/scaffold-demo");

    await user.type(await screen.findByLabelText("Поиск"), "старый запрос");
    await user.click(
      screen.getByRole("button", { name: "Добавить подходящий корабль в Flagship Element" }),
    );

    expect(screen.getByLabelText("Поиск")).toHaveValue("");
    expect(screen.getByLabelText("Категория")).toHaveValue("Flagship");
    expect(screen.getByText("Akita Demonstrator")).toBeVisible();
    expect(screen.queryByText("Line Pattern 002")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Каталог" })).toHaveFocus());

    await user.selectOptions(screen.getByLabelText("Категория"), "Patrol");
    expect(screen.getByText("Patrol Pattern 017")).toBeVisible();
    expect(screen.queryByText("Patrol Pattern 003")).not.toBeInTheDocument();
    await user.click(screen.getByText("Patrol Pattern 017"));
    expect(screen.getByRole("radio", { name: "Flagship Element" })).toBeChecked();
  });

  it("normalizes a legacy rule deep link to the always-open configuration", async () => {
    renderRoute(
      "/rosters/scaffold-demo?ship=demo-ship-001&shipMode=preview&rule=synthetic-rule-torrent",
    );

    const heading = await screen.findByRole("heading", { name: "Akita Demonstrator" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("region", { name: "Настройка корабля" })).toBeVisible();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Шквал" })).not.toBeInTheDocument();
  });

  it("focuses the ship heading after resolving a direct editor link", async () => {
    renderRoute("/rosters/scaffold-demo?ship=demo-ship-001&shipMode=preview");

    const heading = await screen.findByRole("heading", { name: "Akita Demonstrator" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("uses the HealthGateway injected by the application composition root", async () => {
    readHealth.mockClear();
    renderRoute("/settings");

    expect(await screen.findByText("test-version")).toBeVisible();
    expect(screen.getByText("test-catalog")).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText(/^Пароль/u)).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Создать аккаунт" })).toBeVisible();
    expect(readHealth).toHaveBeenCalledOnce();
  });

  it("keeps battle ship counters hidden until they are enabled in settings", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/settings");

    const toggle = await screen.findByRole("checkbox", {
      name: /Показывать боевые счётчики у кораблей/u,
    });
    expect(toggle).not.toBeChecked();
    expect(window.localStorage.getItem(BATTLE_SHIP_COUNTERS_STORAGE_KEY)).toBeNull();

    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(window.localStorage.getItem(BATTLE_SHIP_COUNTERS_STORAGE_KEY)).toBe("show");
  });

  it("submits private feedback with an optional email", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    submitFeedback.mockClear();
    renderRoute("/feedback");

    await user.type(screen.getByLabelText("Сообщение"), "Добавьте французский ORBAT.");
    await user.type(screen.getByLabelText(/Email/u), "Admiral@Example.com");
    await user.click(screen.getByRole("button", { name: "Отправить обращение" }));

    await waitFor(() =>
      expect(submitFeedback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Добавьте французский ORBAT.",
          email: "Admiral@Example.com",
        }),
      ),
    );
    expect(await screen.findByText(/fb_12345678/u)).toBeVisible();
  });

  it("creates a roster, saves it locally and opens its mandatory elements", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/rosters/new");

    await user.type(await screen.findByLabelText("Название флота"), "Northern Fleet");
    await user.selectOptions(screen.getByLabelText("Фракция"), "demo-empire");
    await user.selectOptions(screen.getByLabelText("Battlefleet"), "demo-empire-patrol");
    await user.click(screen.getByRole("button", { name: "Создать и открыть состав" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Northern Fleet" })).toBeVisible();
    expect(screen.getAllByText("Flagship Element").at(-1)).toBeVisible();
    expect(rosterRepository.save).toHaveBeenCalled();
  });
});
