import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { HealthGateway } from "../application/health/health-contract";
import { createAppRoutes } from "./router";

const readHealth = vi.fn<HealthGateway["read"]>().mockResolvedValue({
  status: "ok",
  environment: "local",
  appVersion: "test-version",
  catalogVersion: "test-catalog",
  commitSha: "0000000000000000000000000000000000000000",
});

const testDependencies = {
  healthGateway: { read: readHealth } satisfies HealthGateway,
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

  it("adds a ship, opens its settings and shows configured models, attachments and escort", async () => {
    const user = userEvent.setup();
    const view = renderRoute("/rosters/scaffold-demo");
    const route = within(view.container);

    await user.type(route.getByRole("searchbox", { name: "Найти корабль" }), "Akita");
    await user.click(
      route.getByRole("button", { name: "Добавить Akita Super Battleship в состав" }),
    );

    expect(route.getByRole("heading", { name: "Akita Super Battleship" })).toBeVisible();
    await user.click(route.getByRole("spinbutton", { name: "Количество моделей" }));
    await user.keyboard("{Control>}a{/Control}3");
    await user.selectOptions(route.getByLabelText("Attachments"), "Heavy Gun Battery");
    await user.clear(route.getByRole("spinbutton", { name: "Количество Escort" }));
    await user.type(route.getByRole("spinbutton", { name: "Количество Escort" }), "2");

    expect(route.getByText("Attachments: Heavy Gun Battery · Escort ×2")).toBeVisible();
    expect(route.getByText("3 мод.")).toBeVisible();
    const flagshipSection = route.getByRole("heading", { name: "Flagship" }).closest("section");
    expect(flagshipSection).not.toBeNull();
    expect(
      within(flagshipSection as HTMLElement).queryByRole("button", {
        name: "Добавьте подходящий корабль",
      }),
    ).not.toBeInTheDocument();
  });

  it("filters the catalog from an available composition section", async () => {
    const user = userEvent.setup();
    const view = renderRoute("/rosters/scaffold-demo");
    const route = within(view.container);

    const lineSection = route.getByRole("heading", { name: "Line" }).closest("section");
    expect(lineSection).not.toBeNull();
    await user.click(
      within(lineSection as HTMLElement).getByRole("button", {
        name: "Добавьте подходящий корабль",
      }),
    );

    expect(route.getByRole("combobox", { name: "Категория" })).toHaveValue("Line");
    expect(route.getByRole("button", { name: "Открыть профиль Dao Light Cruiser" })).toBeVisible();
    expect(
      route.queryByRole("button", { name: "Открыть профиль Akita Super Battleship" }),
    ).not.toBeInTheDocument();
  });

  it("uses the HealthGateway injected by the application composition root", async () => {
    readHealth.mockClear();
    renderRoute("/settings");

    expect(await screen.findByText("test-version")).toBeVisible();
    expect(screen.getByText("test-catalog")).toBeVisible();
    expect(readHealth).toHaveBeenCalledOnce();
  });
});
