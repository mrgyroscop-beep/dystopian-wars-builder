import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { appRoutes } from "./router";

function renderRoute(path: string) {
  const testRouter = createMemoryRouter(appRoutes, { initialEntries: [path] });
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
});
