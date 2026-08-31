import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ModuleLoreButton } from "./ModuleLoreButton";

afterEach(cleanup);

describe("faction module cards", () => {
  it.each([
    ["Alliance", "Альянса", "Моряки Альянса", "The sailors of the Alliance"],
    ["Crown", "Короны", "Флоты всех великих держав", "The navies of every Great Power"],
    [
      "Enlightened",
      "Просвещённых",
      "Тяжёлым батареям E.S.C.F.",
      "The heavy gun batteries favoured",
    ],
    ["Sultanate", "Султаната", "Каждая батарея Kılıç", "Often built of rare metals"],
  ])(
    "opens %s artwork and Russian lore, then its English original",
    async (faction, arsenal, ru, en) => {
      const user = userEvent.setup();
      render(<ModuleLoreButton faction={faction} name="Heavy Gun Battery" />);
      const trigger = screen.getByRole("button");
      await user.click(trigger);
      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveTextContent(`Арсенал ${arsenal}`);
      expect(dialog).toHaveTextContent(ru);
      expect(within(dialog).getByRole("img")).toHaveAttribute(
        "src",
        `/modules/${faction.toLowerCase()}/heavy-gun-battery.webp`,
      );
      await user.click(within(dialog).getByRole("button", { name: "EN · Оригинал" }));
      expect(dialog).toHaveTextContent(en);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    },
  );

  it.each([
    ["Commonwealth", "Tri-Railgun"],
    ["Imperium", "Shroud Generator"],
    ["Union", "Heavy Gun Battery"],
    ["Union", "Chesapeake Gatling Gun"],
  ])("identifies assembly artwork and missing lore for %s %s", async (faction, name) => {
    const user = userEvent.setup();
    render(<ModuleLoreButton faction={faction} name={name} />);
    await user.click(screen.getByRole("button"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Лорное описание этого модуля отсутствует");
    expect(within(dialog).getByRole("img")).toHaveAttribute(
      "src",
      expect.stringContaining(`/modules/${faction.toLowerCase()}/`),
    );
    expect(within(dialog).getByRole("link")).toHaveAttribute(
      "href",
      expect.stringContaining("assembly-guides/"),
    );
    expect(within(dialog).queryByRole("group", { name: "Язык лора" })).not.toBeInTheDocument();
    if (name === "Chesapeake Gatling Gun") {
      expect(within(dialog).getByRole("link")).toHaveAttribute(
        "href",
        expect.stringContaining("Long-Range-Squadrons_W.pdf#page=10"),
      );
    }
  });

  it("shows translated lore without a broken image when the ORBAT has no illustration", async () => {
    const user = userEvent.setup();
    render(<ModuleLoreButton faction="Enlightened" name="Advanced Aetheric Lance" />);
    await user.click(screen.getByRole("button"));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("В ORBAT нет отдельной иллюстрации");
    expect(dialog).toHaveTextContent("Герман Нойер");
    expect(within(dialog).queryByRole("img")).not.toBeInTheDocument();
  });

  it("does not borrow another faction's record for an unpublished module", () => {
    render(<ModuleLoreButton faction="Union" name="Atomic Generator" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
