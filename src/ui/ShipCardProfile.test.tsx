import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { ShipEditorReadyReadModel } from "../application/rosters/ship-editor";
import type { RuleReadModel, WeaponProfileReadModel } from "../application/rosters/profile-rules";
import { ShipCardProfile, ShipMobileProfile } from "./ShipCardProfile";

afterEach(cleanup);

describe("ShipCardProfile", () => {
  it("renders readable vertical sections and keeps mobile traits interactive", async () => {
    const user = userEvent.setup();
    render(<ShipMobileProfile faction="Empire" model={model()} />);

    const profile = screen.getByRole("article", {
      name: "Мобильный профиль Akita Super Battleship",
    });
    expect(within(profile).getByRole("heading", { name: "Характеристики" })).toBeVisible();
    expect(within(profile).getByText("MAS").closest("div")).toHaveTextContent("6");
    expect(within(profile).getByRole("heading", { name: "Оружие" })).toBeVisible();
    expect(within(profile).getByText("Odachi Gyorai Salvo")).toBeVisible();
    expect(within(profile).getByRole("heading", { name: "Опции хардпоинтов" })).toBeVisible();

    const stoic = within(profile).getByRole("button", { name: "Показать описание Stoic" });
    expect(
      within(profile).getByRole("button", { name: "Показать описание Heavy Shield Generator" }),
    ).toBeVisible();
    expect(
      within(profile).getByRole("button", { name: "Показать описание All-Around" }),
    ).toBeVisible();
    await user.click(stoic);
    expect(screen.getByRole("dialog", { name: "Stoic" })).toHaveTextContent(
      "This model ignores Disorder.",
    );
  });

  it("aligns stats, renders hardpoint profiles and opens quality descriptions", async () => {
    const user = userEvent.setup();
    render(<ShipCardProfile faction="Empire" model={model()} />);

    expect(screen.getByRole("article", { name: "Карточка Akita Super Battleship" })).toHaveStyle({
      "--ship-card-accent": "#a70d12",
    });
    expect(document.querySelectorAll(".ship-card__stats > div")).toHaveLength(10);
    expect(screen.getByTitle("MAS")).toHaveTextContent("6");
    expect(screen.getByTitle("SPD")).toHaveTextContent('4"–8"');

    const main = screen.getByRole("heading", { name: "Weapons" }).closest("section")!;
    expect(within(main).getByRole("row", { name: /Odachi Gyorai Salvo/u })).toBeInTheDocument();
    const options = screen.getByRole("heading", { name: "Hardpoint options" }).closest("section")!;
    expect(document.querySelector(".ship-card__tables")).toHaveStyle({
      gridTemplateRows: "3fr 4fr",
    });
    expect(
      within(options).getByRole("row", { name: /Heavy Corrosive Mortar/u }),
    ).toBeInTheDocument();
    expect(within(options).getByRole("img", { name: "Тяжёлый орудийный слот" })).toBeVisible();
    expect(within(options).getByRole("img", { name: "Лёгкий орудийный слот" })).toBeVisible();
    expect(within(main).queryByRole("img", { name: /орудийный слот/u })).not.toBeInTheDocument();

    const hazard = within(options).getByRole("button", { name: "Показать описание Hazard (1)" });
    expect(
      within(options).getByRole("button", { name: "Показать описание All-Around" }),
    ).toBeVisible();
    expect(
      within(options).getByRole("button", { name: "Показать описание Solex (2)" }),
    ).toBeVisible();
    await user.click(hazard);
    expect(screen.getByRole("dialog", { name: "Hazard (1)" })).toHaveTextContent(
      "Roll X Critical Damage Dice.",
    );
    expect(screen.getByRole("button", { name: "Закрыть описание правила" })).toHaveFocus();
    await user.keyboard("{Tab}{Escape}");
    expect(screen.queryByRole("dialog", { name: "Hazard (1)" })).not.toBeInTheDocument();
    expect(hazard).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Показать описание Stoic" }));
    expect(screen.getByRole("dialog", { name: "Stoic" })).toHaveTextContent(
      "This model ignores Disorder.",
    );
    expect(screen.getByRole("dialog", { name: "Stoic" })).toHaveTextContent("Property");
    await user.keyboard("{Escape}");

    await user.click(
      screen.getByRole("button", { name: "Показать описание Heavy Shield Generator" }),
    );
    expect(screen.getByRole("dialog", { name: "Heavy Shield Generator" })).toHaveTextContent(
      "This model has a shield generator.",
    );
    expect(screen.getByRole("dialog", { name: "Heavy Shield Generator" })).toHaveTextContent(
      "System",
    );
  });
});

function model(): ShipEditorReadyReadModel {
  const mainWeapon = weapon("odachi", "Odachi Gyorai Salvo", "F", "10", "10", "10", "Torpedo");
  const optionWeapon = {
    ...weapon(
      "mortar",
      "Heavy Corrosive Mortar",
      "FPS",
      "—",
      "4",
      "6",
      "All-Around, Hazard (1), Solex (2)",
    ),
    qualityRules: [
      rule("all-around", "All Around", "Contributes regardless of the targeting arc."),
      rule("hazard", "Hazard", "Roll X Critical Damage Dice."),
      rule("solex", "Solex", "Convert up to X Standard Counters."),
    ],
  };
  return {
    dataState: "ready",
    mode: "instance",
    instanceId: "akita-instance",
    name: "Akita Super Battleship",
    card: {
      role: "Flagship",
      tags: ["Empire", "Japanese", "Surface", "Flagship"],
      nation: "Japanese",
      platform: "Surface",
    },
    basePoints: "350",
    optionPoints: "0",
    derivedPoints: "0",
    totalPoints: "350",
    victoryPoints: "9",
    mandatory: { selected: 0, required: 4 },
    validity: "invalid",
    persistence: "saved-local",
    system: "ready",
    groups: [
      {
        id: "hardpoint",
        label: "Heavy Hardpoint",
        help: "Hardpoint",
        scope: "unit",
        control: "exclusive",
        minimum: 1,
        maximum: 1,
        options: [
          {
            id: "mortar-option",
            label: "Heavy Corrosive Mortar",
            kind: "Weapon",
            costLabel: "Бесплатно",
            selectedQuantity: 0,
            availability: "available",
            reason: null,
            profile: optionWeapon,
          },
        ],
      },
      {
        id: "generator",
        label: "Generator Hardpoints",
        help: "Generator",
        scope: "unit",
        control: "quantity",
        minimum: 0,
        maximum: 1,
        options: [],
      },
      {
        id: "light-hardpoint",
        label: "Light Hardpoint",
        help: "Hardpoint",
        scope: "unit",
        control: "exclusive",
        minimum: 0,
        maximum: 1,
        options: [
          {
            id: "seismic-option",
            label: "Seismic Mortar",
            kind: "Weapon",
            costLabel: "Бесплатно",
            selectedQuantity: 0,
            availability: "available",
            reason: null,
            profile: weapon("seismic", "Seismic Mortar", "FPS", "—", "3", "1", "Mayhem"),
          },
        ],
      },
      {
        id: "escorts",
        label: "Escorts",
        help: "Attachments",
        scope: "unit",
        control: "quantity",
        minimum: 0,
        maximum: 4,
        options: [],
      },
    ],
    fleetGroups: [],
    modelQuantity: {
      instanceId: "akita-model",
      value: 1,
      minimum: 1,
      maximum: 1,
      fixed: true,
    },
    problems: [],
    profileRules: {
      variant: "effective",
      sourceCatalogVersion: "catalog",
      versionState: "current",
      sections: [
        { id: "model", label: "Model", rows: [] },
        {
          id: "properties",
          label: "Properties",
          rows: [
            field("mass", "Mass", "6"),
            field("speed", "Speed", '4"–8"'),
            field("turn", "Turn", "2"),
            field("defence", "Defence", "8"),
            field("armour", "Armour", "6"),
            field("hull", "Hull", "14"),
            field("actions", "Actions", "4"),
            field("broadside", "Broadside", "4"),
            field("repair", "Repair", "5"),
            field("crew", "Crew", "11"),
            field("properties", "Properties", "Deceptive Deployment, Stoic", [
              rule("deceptive-deployment", "Deceptive Deployment", "Deploy this model later."),
              rule("stoic", "Stoic", "This model ignores Disorder."),
            ]),
            field("systems", "Systems", "Heavy Shield Generator", [
              rule(
                "heavy-shield-generator",
                "Heavy Shield Generator",
                "This model has a shield generator.",
              ),
            ]),
          ],
        },
        { id: "systems", label: "Systems", rows: [] },
      ],
      weapons: [mainWeapon],
      rules: [],
      diagnostics: [],
    },
    breakdown: [],
  };
}

function field(id: string, label: string, value: string, rules?: readonly RuleReadModel[]) {
  return {
    id,
    label,
    value: {
      plainText: value,
      blocks: [{ type: "paragraph" as const, children: [{ type: "text" as const, value }] }],
      contentUnavailable: false,
      diagnostics: [],
    },
    ...(rules ? { rules } : {}),
    provenance: null,
  };
}

function weapon(
  id: string,
  name: string,
  arc: string,
  close: string,
  standard: string,
  extreme: string,
  qualities: string,
): WeaponProfileReadModel {
  return { id, weapon: name, arc, close, standard, extreme, qualities, provenance: null };
}

function rule(id: string, label: string, description: string) {
  return {
    id,
    label,
    description: {
      plainText: description,
      blocks: [
        { type: "paragraph" as const, children: [{ type: "text" as const, value: description }] },
      ],
      contentUnavailable: false,
      diagnostics: [],
    },
    available: true,
    diagnostic: null,
  };
}
