import { describe, expect, it } from "vitest";

import { createDemonstrationFleetCatalogGateway } from "../../infrastructure/catalog/demonstration-fleet-catalog";
import { filterShipLibrary, openShipLibrary, type ShipLibraryDependencies } from "./ship-library";

const dependencies: ShipLibraryDependencies = {
  setupGateway: {
    load: () =>
      Promise.resolve({
        contractVersion: 1,
        contentVersion: "demonstration-1",
        mode: "current",
        notice: null,
        factions: [{ id: "demo-empire", label: "Empire", battlefleets: [] }],
      }),
  },
  catalogGateway: createDemonstrationFleetCatalogGateway(),
};

describe("ship library", () => {
  it("opens the faction catalog with the internal profile and extracted ORBAT page", async () => {
    const catalog = await openShipLibrary("demo-empire", dependencies);
    const session = catalog?.session;

    expect(session?.faction.label).toBe("Empire");
    expect(session?.ships).toHaveLength(1);
    expect(session?.ships[0]).toMatchObject({
      name: "Akita Demonstrator",
      orbatPageUrl: "/orbat-cards/empire/23.webp",
      category: "Flagship",
    });
    expect(
      catalog?.profile(session?.ships[0]?.id ?? "")?.profileRules.weapons.length,
    ).toBeGreaterThan(0);
  });

  it("filters by type and sorts prices in either direction", () => {
    const ships = [
      {
        id: "expensive",
        name: "Expensive Line",
        category: "Line" as const,
        role: "Line vessel",
        platform: "Surface",
        points: "200",
        victoryPoints: "4",
      },
      {
        id: "cheap",
        name: "Cheap Flagship",
        category: "Flagship" as const,
        role: "Flagship vessel",
        platform: "Surface",
        points: "100",
        victoryPoints: "2",
      },
    ] as unknown as Parameters<typeof filterShipLibrary>[0];

    expect(filterShipLibrary(ships, "", "all", "ascending").map((ship) => ship.id)).toEqual([
      "cheap",
      "expensive",
    ]);
    expect(filterShipLibrary(ships, "", "all", "descending").map((ship) => ship.id)).toEqual([
      "expensive",
      "cheap",
    ]);
    expect(filterShipLibrary(ships, "cheap", "Flagship", "ascending")).toHaveLength(1);
  });
});
