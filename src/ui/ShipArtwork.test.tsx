import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ShipArtwork } from "./ShipArtwork";
afterEach(cleanup);
describe("ship image preview", () => {
  it("opens in place and closes by backdrop, close button and Escape", () => {
    render(<ShipArtwork faction="Imperium" name="Elector" />);
    const open = screen.getByRole("button", { name: "Увеличить изображение Elector" });
    open.focus();
    fireEvent.click(open);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть окно по фону" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(open);
    fireEvent.click(open);
    fireEvent.click(screen.getByRole("button", { name: "Закрыть изображение корабля" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(open);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
