import { describe, expect, it } from "vitest";

import { createDemonstrationWorkspaceRoster } from "../../infrastructure/catalog/demonstration-fleet-catalog";
import { storedRosterSchema } from "./create-roster";

describe("stored roster instance contract", () => {
  it("accepts a strict well-formed roster selection instance", () => {
    const roster = createDemonstrationWorkspaceRoster();
    const candidate = {
      ...roster,
      roster: {
        ...roster.roster,
        rootInstanceIds: ["root"],
        instances: {
          root: {
            contractVersion: 1,
            id: "root",
            definitionId: "demo-empire-patrol",
            placementId: null,
            slotId: null,
            parentInstanceId: null,
            forceInstanceId: "root",
            quantity: 1,
          },
        },
      },
    };
    expect(storedRosterSchema.safeParse(candidate).success).toBe(true);
  });

  it.each([
    ["unknown instance member", { forged: true }],
    ["zero quantity", { quantity: 0 }],
    ["key/id mismatch", { id: "different" }],
  ])("rejects %s instead of accepting instances as unknown", (_label, patch) => {
    const roster = createDemonstrationWorkspaceRoster();
    const instance = {
      contractVersion: 1,
      id: "root",
      definitionId: "demo-empire-patrol",
      placementId: null,
      slotId: null,
      parentInstanceId: null,
      forceInstanceId: "root",
      quantity: 1,
      ...patch,
    };
    const candidate = {
      ...roster,
      roster: {
        ...roster.roster,
        rootInstanceIds: ["root"],
        instances: { root: instance },
      },
    };
    expect(storedRosterSchema.safeParse(candidate).success).toBe(false);
  });
});
