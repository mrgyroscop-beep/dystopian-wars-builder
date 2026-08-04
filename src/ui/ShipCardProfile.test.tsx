import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ShipEditorReadyReadModel } from "../application/rosters/ship-editor";
import type { WeaponProfileReadModel } from "../application/rosters/profile-rules";
import { ShipCardProfile } from "./ShipCardProfile";

afterEach(cleanup);

describe("ShipCardProfile", () => {
  it("aligns ten stats and renders optional hardpoint profiles in a second table", () => {
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
    expect(
      within(options).getByRole("row", { name: /Heavy Corrosive Mortar/u }),
    ).toBeInTheDocument();
  });
});

function model(): ShipEditorReadyReadModel {
  const mainWeapon = weapon("odachi", "Odachi Gyorai Salvo", "F", "10", "10", "10", "Torpedo");
  const optionWeapon = weapon(
    "mortar",
    "Heavy Corrosive Mortar",
    "FPS",
    "—",
    "4",
    "6",
    "All-Around, Indirect",
  );
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
            field("properties", "Properties", "Deceptive Deployment, Stoic"),
            field("systems", "Systems", "Heavy Shield Generator"),
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

function field(id: string, label: string, value: string) {
  return {
    id,
    label,
    value: {
      plainText: value,
      blocks: [{ type: "paragraph" as const, children: [{ type: "text" as const, value }] }],
      contentUnavailable: false,
      diagnostics: [],
    },
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
