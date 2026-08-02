import { describe, expect, it } from "vitest";

import {
  createDemonstrationFleetCatalogGateway,
  createDemonstrationWorkspaceRoster,
} from "../../infrastructure/catalog/demonstration-fleet-catalog";
import type { RosterRepository, StoredRoster } from "./create-roster";
import {
  filterCatalogItems,
  openRosterWorkspace,
  type RosterWorkspaceDependencies,
  type WorkspaceCommandError,
} from "./workspace";

describe("roster workspace application boundary", () => {
  it("projects a deterministic demo-safe catalog with all category families and 100+ results", async () => {
    const fixture = harness();
    const session = await openRosterWorkspace("scaffold-demo", fixture.dependencies);

    expect(session).not.toBeNull();
    expect(session!.model.catalog).toHaveLength(112);
    expect(new Set(session!.model.catalog.map((item) => item.category))).toEqual(
      new Set(["Flagship", "Line", "Patrol", "Support", "Scout", "Logistical", "Другое"]),
    );
    expect(filterCatalogItems(session!.model.catalog, "pattern 017", "Patrol")).toHaveLength(1);
    expect(filterCatalogItems(session!.model.catalog, "not present", "all")).toEqual([]);
    expect(session!.model.catalog.every((item) => item.id.startsWith("demo-"))).toBe(true);
  });

  it("creates the Battlefleet structure idempotently without mutating the input fixture", async () => {
    const fixture = harness();
    const original = structuredClone(fixture.fallback);
    const first = await openRosterWorkspace("scaffold-demo", fixture.dependencies);
    const savedAfterFirstOpen = fixture.saved.get("scaffold-demo")!;
    const firstSaveCount = fixture.saveCalls.length;
    const second = await openRosterWorkspace("scaffold-demo", fixture.dependencies);

    expect(fixture.fallback).toEqual(original);
    expect(first!.model.elements.map((element) => element.label)).toEqual([
      "Flagship Element",
      "Line Element",
    ]);
    expect(Object.keys(savedAfterFirstOpen.roster.instances)).toHaveLength(3);
    expect(second!.model.elements).toEqual(first!.model.elements);
    expect(fixture.saveCalls).toHaveLength(firstSaveCount);
  });

  it("adds, duplicates, deletes, evaluates and restores an exact locally saved snapshot", async () => {
    const fixture = harness(["instance-1", "instance-2"]);
    const session = (await openRosterWorkspace("scaffold-demo", fixture.dependencies))!;
    const initialSnapshot = structuredClone(fixture.saved.get("scaffold-demo")!.roster);

    const added = await session.execute({ type: "add", definitionId: "demo-ship-001" });
    expect(added.summary).toMatchObject({
      points: "45",
      victoryPoints: "1",
      persistence: "saved-local",
    });
    expect(initialSnapshot).not.toEqual(fixture.saved.get("scaffold-demo")!.roster);
    const flagship = added.elements.find((element) => element.definitionId === "demo-flagship")!;
    expect(flagship.instances[0]).toMatchObject({
      id: "instance-1",
      definitionId: "demo-ship-001",
    });

    const duplicated = await session.execute({ type: "duplicate", instanceId: "instance-1" });
    expect(duplicated.summary.points).toBe("90");
    expect(
      duplicated.elements.flatMap((element) => element.instances).map((item) => item.id),
    ).toContain("instance-2");

    const afterDelete = await session.execute({ type: "delete", instanceId: "instance-1" });
    expect(afterDelete.summary.points).toBe("45");
    expect(
      afterDelete.elements.flatMap((element) => element.instances).map((item) => item.id),
    ).toEqual(["instance-2"]);

    const reopened = await openRosterWorkspace("scaffold-demo", fixture.dependencies);
    expect(reopened!.model).toEqual(afterDelete);
  });

  it("requires an explicit Element for multiple targets and fails closed for unavailable records", async () => {
    const fixture = harness(["instance-17"]);
    const session = (await openRosterWorkspace("scaffold-demo", fixture.dependencies))!;
    await expect(
      session.execute({ type: "add", definitionId: "demo-ship-017" }),
    ).rejects.toMatchObject({
      code: "TARGET_REQUIRED",
    } satisfies Partial<WorkspaceCommandError>);
    const line = session.model.elements.find((element) => element.definitionId === "demo-line")!;
    const added = await session.execute({
      type: "add",
      definitionId: "demo-ship-017",
      targetElementInstanceId: line.id,
    });
    expect(added.elements.find((element) => element.id === line.id)!.instances).toHaveLength(1);

    await expect(
      session.execute({ type: "add", definitionId: "demo-ship-029" }),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
      message: "Этот учебный корпус недоступен для выбранного Battlefleet.",
    } satisfies Partial<WorkspaceCommandError>);
    await expect(
      session.execute({ type: "add", definitionId: "demo-ship-031" }),
    ).rejects.toMatchObject({
      code: "UNAVAILABLE",
    } satisfies Partial<WorkspaceCommandError>);
  });

  it("keeps the evaluated candidate in memory after save failure and supports Retry", async () => {
    const fixture = harness(["unsaved-1"]);
    fixture.failSave.value = true;
    const session = (await openRosterWorkspace("scaffold-demo", fixture.dependencies))!;

    const unsaved = await session.execute({ type: "add", definitionId: "demo-ship-001" });
    expect(unsaved.summary.persistence).toBe("save-error");
    expect(unsaved.summary.points).toBe("45");
    expect(unsaved.elements.flatMap((element) => element.instances)).toHaveLength(1);

    fixture.failSave.value = false;
    const saved = await session.retrySave();
    expect(saved.summary.persistence).toBe("saved-local");
    expect(fixture.saved.get("scaffold-demo")!.roster.instances["unsaved-1"]).toBeDefined();
  });

  it("opens, targets, saves and reloads a Crown Vanguard roster created by KAN-33", async () => {
    const fixture = harness(["crown-ship-1"]);
    const crown = crownRoster();
    const dependencies: RosterWorkspaceDependencies = {
      ...fixture.dependencies,
      fallbackRoster: (id) => (id === crown.id ? crown : null),
    };

    const session = await openRosterWorkspace(crown.id, dependencies);
    expect(session).not.toBeNull();
    expect(session!.model.catalog).toHaveLength(112);
    expect(session!.model.elements.map((element) => element.label)).toEqual([
      "Command Element",
      "Patrol Element",
    ]);
    const asterion = session!.model.catalog.find((item) => item.id === "demo-ship-001")!;
    expect(asterion.availability).toEqual({ state: "available", reason: null });
    expect(asterion.eligibleTargets.map((target) => target.elementLabel)).toEqual([
      "Command Element",
    ]);

    const added = await session!.execute({ type: "add", definitionId: asterion.id });
    expect(added.summary).toMatchObject({
      points: "45",
      victoryPoints: "1",
      persistence: "saved-local",
    });
    expect(
      added.elements.find((element) => element.definitionId === "demo-command")!.instances,
    ).toContainEqual(expect.objectContaining({ id: "crown-ship-1", definitionId: asterion.id }));

    const reopened = await openRosterWorkspace(crown.id, dependencies);
    expect(reopened!.model).toEqual(added);
    expect(Object.keys(fixture.saved.get(crown.id)!.roster.instances)).toHaveLength(4);
  });
});

function crownRoster(): StoredRoster {
  const base = createDemonstrationWorkspaceRoster("crown-vanguard");
  return {
    ...base,
    name: "Crown Vanguard",
    faction: { id: "demo-crown", label: "Crown" },
    battlefleet: { id: "demo-crown-vanguard", label: "Vanguard Exercise" },
    requiredElements: [
      { id: "demo-command", label: "Command Element", minimum: 1 },
      { id: "demo-patrol", label: "Patrol Element", minimum: 1 },
    ],
  };
}

function harness(ids: string[] = []) {
  const fallback = createDemonstrationWorkspaceRoster();
  const saved = new Map<string, StoredRoster>();
  const saveCalls: StoredRoster[] = [];
  const failSave = { value: false };
  const repository: RosterRepository = {
    contractVersion: 1,
    save(roster) {
      saveCalls.push(structuredClone(roster));
      if (failSave.value) return Promise.reject(new Error("storage unavailable"));
      saved.set(roster.id, structuredClone(roster));
      return Promise.resolve();
    },
    read(id) {
      return Promise.resolve(saved.get(id) ? structuredClone(saved.get(id)!) : null);
    },
  };
  let index = 0;
  const dependencies: RosterWorkspaceDependencies = {
    catalogGateway: createDemonstrationFleetCatalogGateway(),
    rosterRepository: repository,
    createId: () => ids[index++] ?? `generated-${index}`,
    now: () => "2026-08-02T12:00:00.000Z",
    fallbackRoster: (id) => (id === fallback.id ? fallback : null),
  };
  return { dependencies, failSave, fallback, saveCalls, saved };
}
