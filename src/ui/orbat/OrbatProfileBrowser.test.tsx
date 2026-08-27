import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { OrbatProfileBrowser } from "./OrbatProfileBrowser";

const defaultProps = {
  category: "all" as const,
  onAdd: () => undefined,
  onCategoryChange: () => undefined,
};

describe("OrbatProfileBrowser", () => {
  it("opens the complete profile page for the selected ship", async () => {
    const user = userEvent.setup();
    render(<OrbatProfileBrowser {...defaultProps} />);

    await user.type(screen.getByRole("searchbox", { name: "Найти корабль" }), "Akita");
    await user.click(
      screen.getByRole("button", { name: "Открыть профиль Akita Super Battleship" }),
    );

    expect(screen.getByRole("dialog", { name: "Akita Super Battleship" })).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "Полная страница профиля Akita Super Battleship: таблица характеристик и изображение корабля",
      }),
    ).toHaveAttribute("src", "/orbats/empire/4.01/profile-page-023.webp");
  });

  it("closes the profile with Escape and restores the ship button focus", async () => {
    const user = userEvent.setup();
    render(<OrbatProfileBrowser {...defaultProps} />);
    const shipButton = screen.getByRole("button", { name: "Открыть профиль Wuhan Repair Ship" });

    await user.click(shipButton);
    expect(screen.getByRole("dialog", { name: "Wuhan Repair Ship" })).toBeVisible();
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(shipButton).toHaveFocus();
  });
});
