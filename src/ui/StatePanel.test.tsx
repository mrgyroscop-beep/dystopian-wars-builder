import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatePanel } from "./StatePanel";

describe("StatePanel", () => {
  it("exposes an error fixture as an alert without relying on colour", () => {
    render(
      <StatePanel description="Повторите попытку." state="error" title="Не удалось загрузить" />,
    );

    expect(screen.getByRole("alert")).toHaveAttribute("data-state", "error");
    expect(screen.getByRole("heading", { name: "Не удалось загрузить" })).toBeVisible();
    expect(screen.getByText("Повторите попытку.")).toBeVisible();
  });

  it("marks loading as busy status text", () => {
    render(<StatePanel description="Проверяем данные." state="loading" title="Загрузка" />);

    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });
});
