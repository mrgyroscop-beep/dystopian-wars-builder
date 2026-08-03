import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HealthGateway } from "../application/health/health-contract";
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

const storedRosters = new Map<string, StoredRoster>();
const rosterRepository = {
  contractVersion: 1 as const,
  save: vi.fn((roster: StoredRoster) => {
    storedRosters.set(roster.id, roster);
    return Promise.resolve();
  }),
  read: vi.fn((id: string) => Promise.resolve(storedRosters.get(id) ?? null)),
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

afterEach(cleanup);
const testDependencies = {
  authGateway: {
    contractVersion: 1 as const,
    session: () => Promise.resolve(null),
    register: () => Promise.reject(new Error("not used")),
    login: () => Promise.reject(new Error("not used")),
    logout: () => Promise.resolve(),
    deleteAccount: () => Promise.resolve(),
  },
  healthGateway: { read: readHealth } satisfies HealthGateway,
  rosterCreation,
  rosterLibrary: {
    rosterRepository: syncRepository,
    createId: () => crypto.randomUUID(),
    now: () => "2026-08-02T10:00:00.000Z",
  },
  rosterWorkspace: {
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
    await waitFor(() => expect(document.title).toContain("Флоты"));
  });

  it("renders a controlled 404 with a recovery action", () => {
    renderRoute("/route-that-does-not-exist");

    expect(screen.getByRole("heading", { level: 1, name: "Такого маршрута нет" })).toBeVisible();
    expect(screen.getByRole("link", { name: "К моим флотам" })).toHaveAttribute("href", "/");
  });

  it("renders a deep roster route without loading the library first", async () => {
    renderRoute("/rosters/scaffold-demo");

    expect(await screen.findByRole("heading", { level: 1, name: "Учебная эскадра" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Состав" })).toBeVisible();
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
