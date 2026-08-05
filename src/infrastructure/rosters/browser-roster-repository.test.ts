import { beforeEach, describe, expect, it } from "vitest";

import { createDemonstrationWorkspaceRoster } from "../catalog/demonstration-fleet-catalog";
import { createBrowserRosterRepository } from "./browser-roster-repository";

describe("browser roster repository", () => {
  beforeEach(() => window.localStorage.clear());

  it("hides internal demonstration rosters while preserving published user rosters", async () => {
    const repository = createBrowserRosterRepository(window.localStorage);
    const demonstration = createDemonstrationWorkspaceRoster("scaffold-demo");
    const published = {
      ...createDemonstrationWorkspaceRoster("user-roster"),
      name: "Игровой флот",
      roster: {
        ...createDemonstrationWorkspaceRoster("user-roster").roster,
        catalogContentVersion: "a".repeat(64),
      },
    };

    await repository.save(demonstration);
    await repository.save(published);

    expect(await repository.read(demonstration.id)).toBeNull();
    expect(await repository.read(published.id)).toEqual(published);
    expect(await repository.list()).toEqual([published]);
    expect(window.localStorage.getItem(`dwb.roster.v1.${demonstration.id}`)).not.toBeNull();
  });
});
