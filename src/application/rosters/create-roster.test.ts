import { describe, expect, it, vi } from "vitest";

import type { DomainCatalog } from "../../domain/catalog";
import {
  createRoster,
  CreateRosterValidationError,
  projectRosterSetup,
  type RosterRepository,
  type RosterSetupCatalog,
} from "./create-roster";

const setup: RosterSetupCatalog = {
  contractVersion: 1,
  contentVersion: "catalog-1",
  mode: "current",
  notice: null,
  factions: [
    {
      id: "empire",
      label: "Empire",
      battlefleets: [
        {
          id: "patrol",
          factionId: "empire",
          label: "Patrol",
          summary: "Fast fleet",
          requiredElements: [{ id: "line", label: "Line Element", minimum: 1 }],
        },
      ],
    },
  ],
};

describe("roster creation", () => {
  it("projects Battlefleet options and mandatory elements from normalized forceEntry entities", () => {
    const catalog = {
      contentVersion: "real-content",
      entities: {
        faction: entity("faction", "Faction", "Empire", "Empire.cat"),
        fleet: entity("fleet", "Battlefleet", "Grand Fleet", "Empire.cat", {
          description: { plainText: "A formation built around a command element." },
        }),
        element: entity("element", "BattlefleetElement", "Command Element", "Empire.cat", {
          constraintIds: ["constraint"],
        }),
        constraint: entity("constraint", "Constraint", "Minimum", "Empire.cat", {
          expression: {
            operator: "min",
            field: "selections",
            value: "1",
            evaluable: true,
          },
        }),
        unit: entity("unit", "Unit", "Not a Battlefleet", "Empire.cat"),
      },
      placements: {
        fleetElement: {
          ownerId: "fleet",
          definitionId: "element",
          resolved: true,
          overlay: { constraintIds: [] },
        },
      },
    } as unknown as DomainCatalog;

    expect(projectRosterSetup(catalog)).toMatchObject({
      contentVersion: "real-content",
      factions: [
        {
          label: "Empire",
          battlefleets: [
            {
              label: "Grand Fleet",
              requiredElements: [{ label: "Command Element", minimum: 1 }],
            },
          ],
        },
      ],
    });
  });

  it("validates, persists and returns an empty versioned roster snapshot", async () => {
    const save = vi.fn<RosterRepository["save"]>().mockResolvedValue(undefined);
    const roster = await createRoster(
      {
        name: "  Northern Squadron  ",
        factionId: "empire",
        battlefleetId: "patrol",
        pointsLimit: "1000",
      },
      {
        setupGateway: { contractVersion: 1, load: () => Promise.resolve(setup) },
        rosterRepository: { contractVersion: 1, save, read: () => Promise.resolve(null) },
        createId: () => "roster-1",
        now: () => "2026-08-02T10:00:00.000Z",
      },
    );

    expect(roster).toMatchObject({
      id: "roster-1",
      name: "Northern Squadron",
      limits: { points: 1000 },
      roster: { catalogContentVersion: "catalog-1", rootInstanceIds: [], instances: {} },
    });
    expect(save).toHaveBeenCalledWith(roster);
  });

  it("rejects a Battlefleet that does not belong to the selected faction", async () => {
    await expect(
      createRoster(
        {
          name: "Fleet",
          factionId: "empire",
          battlefleetId: "foreign",
          pointsLimit: "1000",
        },
        {
          setupGateway: { contractVersion: 1, load: () => Promise.resolve(setup) },
          rosterRepository: {
            contractVersion: 1,
            save: () => Promise.resolve(),
            read: () => Promise.resolve(null),
          },
          createId: () => "roster-1",
          now: () => "2026-08-02T10:00:00.000Z",
        },
      ),
    ).rejects.toBeInstanceOf(CreateRosterValidationError);
  });
});

function entity(
  id: string,
  kind: string,
  label: string,
  documentPath: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    kind,
    label: { plainText: label },
    description: undefined,
    fields: [],
    constraintIds: [],
    provenance: { documentPath },
    ...overrides,
  };
}
