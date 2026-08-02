import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { HealthGateway } from "../application/health/health-contract";
import type { StoredRoster } from "../application/rosters/create-roster";
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
const rosterCreation = {
  setupGateway: {
    contractVersion: 1 as const,
    load: () =>
      Promise.resolve({
        contractVersion: 1 as const,
        contentVersion: "test-catalog",
        mode: "current" as const,
        notice: null,
        factions: [
          {
            id: "empire",
            label: "Empire",
            battlefleets: [
              {
                id: "patrol",
                factionId: "empire",
                label: "Patrol Fleet",
                summary: "A test Battlefleet.",
                requiredElements: [{ id: "flagship", label: "Flagship Element", minimum: 1 }],
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
const testDependencies = {
  healthGateway: { read: readHealth } satisfies HealthGateway,
  rosterCreation,
  rosterRepository,
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

  it("renders a deep roster route without loading the library first", () => {
    renderRoute("/rosters/scaffold-demo");

    expect(screen.getByRole("heading", { level: 1, name: "Черновик флота" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Состав" })).toBeVisible();
  });

  it("uses the HealthGateway injected by the application composition root", async () => {
    readHealth.mockClear();
    renderRoute("/settings");

    expect(await screen.findByText("test-version")).toBeVisible();
    expect(screen.getByText("test-catalog")).toBeVisible();
    expect(readHealth).toHaveBeenCalledOnce();
  });

  it("creates a roster, saves it locally and opens its mandatory elements", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderRoute("/rosters/new");

    await user.type(await screen.findByLabelText("Название флота"), "Northern Fleet");
    await user.selectOptions(screen.getByLabelText("Фракция"), "empire");
    await user.selectOptions(screen.getByLabelText("Battlefleet"), "patrol");
    await user.click(screen.getByRole("button", { name: "Создать и открыть состав" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Northern Fleet" })).toBeVisible();
    expect(screen.getByText("Flagship Element")).toBeVisible();
    expect(rosterRepository.save).toHaveBeenCalled();
  });
});
