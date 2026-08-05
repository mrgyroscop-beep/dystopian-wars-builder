import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  storedRosters.clear();
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
  assistantGateway: {
    contractVersion: 1 as const,
    ask: () => Promise.reject(new Error("not used")),
  },
  feedbackGateway: { contractVersion: 1 as const, submit: submitFeedback },
  healthGateway: { read: readHealth } satisfies HealthGateway,
  rosterCreation,
  rosterLibrary: {
    rosterRepository: syncRepository,
    createId: () => crypto.randomUUID(),
    now: () => "2026-08-02T10:00:00.000Z",
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
  return render(<RouterProvider router={testRouter} />);
}

describe("application routes", () => {
  it("renders semantic landmarks, one h1 and the current navigation item", async () => {
    renderRoute("/");

    expect(screen.getByRole("banner")).toBeVisible();
    expect(screen.getByRole("navigation", { name: "Основная навигация" })).toBeVisible();
    expect(screen.getByRole("main")).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Флоты" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("link", { name: "Создать" })).not.toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Войти в аккаунт" })).toHaveTextContent("Войти");
    await waitFor(() => expect(document.title).toContain("Флоты"));
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

  it("renders a deep roster route without loading the library first", async () => {
    renderRoute("/rosters/scaffold-demo");

    expect(await screen.findByRole("heading", { level: 1, name: "Учебная эскадра" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Состав" })).toBeVisible();
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
      await screen.findByRole("button", { name: "Настроить Akita Demonstrator" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Копировать Akita Demonstrator" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Удалить Akita Demonstrator" })).toBeVisible();
  });

  it("opens a stable-ID rule deep link and focuses its heading", async () => {
    renderRoute(
      "/rosters/scaffold-demo?ship=demo-ship-001&shipMode=preview&rule=synthetic-rule-torrent",
    );

    const heading = await screen.findByRole("heading", { name: "Torrent" });
    await waitFor(() => expect(heading).toHaveFocus());
    const visibleSource = screen
      .getAllByText("Источник: каталог demonstration-1")
      .find((source) => !source.closest("[hidden]"));
    expect(visibleSource).toBeVisible();
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
