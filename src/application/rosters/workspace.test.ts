import { describe, expect, it } from "vitest";

import {
  createDemonstrationFleetCatalog,
  createDemonstrationFleetCatalogGateway,
  createDemonstrationWorkspaceRoster,
} from "../../infrastructure/catalog/demonstration-fleet-catalog";
import type { PlacementId } from "../../domain/catalog";
import { createDemonstrationRosterSetupGateway } from "../../infrastructure/catalog/demonstration-roster-setup";
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

  it("uses direct slot options and repairs previously saved nested profile selections", async () => {
    const fixture = harness(["unit-1", "model-1"]);
    const baseCatalog = createDemonstrationFleetCatalog();
    const slot = baseCatalog.slots["demo-akita-slot-psa"]!;
    const directPlacement = baseCatalog.placements[slot.optionPlacementIds[0]!]!;
    const profile = baseCatalog.entities["demo-akita-fore-battery-profile"]!;
    const nestedPlacementId = "demo-nested-weapon-profile" as PlacementId;
    const catalog = {
      ...baseCatalog,
      placements: {
        ...baseCatalog.placements,
        [nestedPlacementId]: {
          ...directPlacement,
          id: nestedPlacementId,
          ownerId: directPlacement.definitionId!,
          definitionId: profile.id,
          order: -1,
        },
      },
      slots: {
        ...baseCatalog.slots,
        [slot.id]: {
          ...slot,
          placementIds: [nestedPlacementId, ...slot.placementIds],
          optionPlacementIds: [nestedPlacementId, ...slot.optionPlacementIds],
        },
      },
    };
    const dependencies: RosterWorkspaceDependencies = {
      ...fixture.dependencies,
      catalogGateway: {
        contractVersion: 1,
        load: () => Promise.resolve(catalog),
      },
    };
    const session = (await openRosterWorkspace("scaffold-demo", dependencies))!;
    await session.execute({ type: "add", definitionId: "demo-ship-001" });

    const stored = fixture.saved.get("scaffold-demo")!;
    const directSelection = Object.values(stored.roster.instances).find(
      (instance) => instance.slotId === slot.id,
    )!;
    expect(directSelection.placementId).not.toBe(nestedPlacementId);
    fixture.saved.set("scaffold-demo", {
      ...stored,
      roster: {
        ...stored.roster,
        instances: {
          ...stored.roster.instances,
          [directSelection.id]: {
            ...directSelection,
            definitionId: profile.id,
            placementId: nestedPlacementId,
          },
        },
      },
    });

    const reopened = (await openRosterWorkspace("scaffold-demo", dependencies))!;
    const repaired = fixture.saved.get("scaffold-demo")!.roster.instances[directSelection.id]!;
    expect(repaired).toMatchObject({
      definitionId: directPlacement.definitionId,
      placementId: directPlacement.id,
    });
    expect(
      reopened.model.problems.some((problem) => problem.code === "PLACEMENT_OWNER_MISMATCH"),
    ).toBe(false);
    const editor = reopened.editor("unit-1", "demo-ship-001");
    if (editor?.dataState !== "ready") throw new Error("Expected ready editor");
    expect(editor.groups.find((group) => group.id === slot.id)!.options).not.toContainEqual(
      expect.objectContaining({ id: nestedPlacementId }),
    );
  });

  it("adds, duplicates, deletes, evaluates and restores an exact locally saved snapshot", async () => {
    const fixture = harness(["instance-1", "model-1", "instance-2", "model-2"]);
    const session = (await openRosterWorkspace("scaffold-demo", fixture.dependencies))!;
    const initialSnapshot = structuredClone(fixture.saved.get("scaffold-demo")!.roster);

    const execution = await session.executeDetailed({
      type: "add",
      definitionId: "demo-ship-001",
    });
    const added = execution.model;
    expect(execution.createdInstanceId).toBe("instance-1");
    expect(added.summary).toMatchObject({
      points: "350",
      victoryPoints: "9",
      persistence: "saved-local",
    });
    expect(initialSnapshot).not.toEqual(fixture.saved.get("scaffold-demo")!.roster);
    const flagship = added.elements.find((element) => element.definitionId === "demo-flagship")!;
    expect(flagship.instances[0]).toMatchObject({
      id: "instance-1",
      definitionId: "demo-ship-001",
    });

    const duplicated = await session.execute({ type: "duplicate", instanceId: "instance-1" });
    expect(duplicated.summary.points).toBe("700");
    expect(
      duplicated.elements.flatMap((element) => element.instances).map((item) => item.id),
    ).toContain("instance-2");

    const afterDelete = await session.execute({ type: "delete", instanceId: "instance-1" });
    expect(afterDelete.summary.points).toBe("350");
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
    const fixture = harness(["unsaved-1", "unsaved-model-1"]);
    fixture.failSave.value = true;
    const session = (await openRosterWorkspace("scaffold-demo", fixture.dependencies))!;

    const unsaved = await session.execute({ type: "add", definitionId: "demo-ship-001" });
    expect(unsaved.summary.persistence).toBe("save-error");
    expect(unsaved.summary.points).toBe("350");
    expect(unsaved.elements.flatMap((element) => element.instances)).toHaveLength(1);

    fixture.failSave.value = false;
    const saved = await session.retrySave();
    expect(saved.summary.persistence).toBe("saved-local");
    expect(fixture.saved.get("scaffold-demo")!.roster.instances["unsaved-1"]).toBeDefined();
  });

  it("keeps the composition unit card equal to editor and workspace totals", async () => {
    const fixture = harness([
      "total-unit",
      "total-model",
      "total-psa",
      "total-fps-1",
      "total-fps-2",
      "total-fps-3",
      "total-repair",
      "total-escorts",
    ]);
    const session = (await openRosterWorkspace("scaffold-demo", fixture.dependencies))!;
    const added = await session.executeDetailed({ type: "add", definitionId: "demo-ship-001" });
    const unitId = added.createdInstanceId!;

    const choose = async (groupLabel: string, optionLabel: string) => {
      const editor = session.editor(unitId, "demo-ship-001");
      if (editor?.dataState !== "ready") throw new Error("Expected ready editor");
      const targetGroup = editor.groups.find((group) => group.label === groupLabel)!;
      const targetOption = targetGroup.options.find((option) => option.label === optionLabel)!;
      await session.execute(
        targetGroup.control === "exclusive"
          ? {
              type: "replace-exclusive",
              instanceId: unitId,
              groupId: targetGroup.id,
              optionId: targetOption.id,
            }
          : {
              type: "set-choice-quantity",
              instanceId: unitId,
              groupId: targetGroup.id,
              optionId: targetOption.id,
              quantity: 1,
            },
      );
    };
    await choose("PSA", "Magma Cast Generator");
    await choose("FPS 1", "Fury Generator");
    await choose("FPS 2", "Rocket Battery");
    await choose("FPS 3", "Shield Generator");
    await choose("Attachments", "Repair Crane");

    expect(
      session.model.problems.filter((problem) =>
        ["SLOT_MIN_NOT_MET", "CONSTRAINT_MIN_NOT_MET"].includes(problem.code),
      ),
    ).toEqual([]);

    let editor = session.editor(unitId, "demo-ship-001");
    if (editor?.dataState !== "ready") throw new Error("Expected ready editor");
    let card = session.model.elements
      .flatMap((element) => element.instances)
      .find((item) => item.id === unitId)!;
    expect([editor.totalPoints, card.points, session.model.summary.points]).toEqual([
      "375",
      "375",
      "375",
    ]);

    const escorts = editor.groups.find((group) => group.label === "Escorts")!;
    const tanuki = escorts.options.find((option) => option.label === "Tanuki Escort")!;
    await session.execute({
      type: "set-choice-quantity",
      instanceId: unitId,
      groupId: escorts.id,
      optionId: tanuki.id,
      quantity: 4,
    });
    editor = session.editor(unitId, "demo-ship-001");
    if (editor?.dataState !== "ready") throw new Error("Expected ready editor");
    card = session.model.elements
      .flatMap((element) => element.instances)
      .find((item) => item.id === unitId)!;
    expect([editor.totalPoints, card.points, session.model.summary.points]).toEqual([
      "405",
      "405",
      "405",
    ]);
    expect(editor.derivedPoints).toBe("-10");
  });

  it("deep-duplicates the configured Akita subtree with fresh IDs", async () => {
    const fixture = harness();
    const session = (await openRosterWorkspace("scaffold-demo", fixture.dependencies))!;
    const added = await session.execute({ type: "add", definitionId: "demo-ship-001" });
    const original = added.elements
      .flatMap((element) => element.instances)
      .find((instance) => instance.definitionId === "demo-ship-001")!;
    const editor = session.editor(original.id, original.definitionId);
    if (editor?.dataState !== "ready") throw new Error("Expected the ship editor to be ready");
    const psa = editor.groups.find((group) => group.label === "PSA")!;
    const magma = psa.options.find((option) => option.label === "Magma Cast Generator")!;
    const escorts = editor.groups.find((group) => group.label === "Escorts")!;
    const tanuki = escorts.options.find((option) => option.label === "Tanuki Escort")!;
    await session.execute({
      type: "replace-exclusive",
      instanceId: original.id,
      groupId: psa.id,
      optionId: magma.id,
    });
    await session.execute({
      type: "set-choice-quantity",
      instanceId: original.id,
      groupId: escorts.id,
      optionId: tanuki.id,
      quantity: 4,
    });
    await session.execute({ type: "duplicate", instanceId: original.id });

    const snapshot = fixture.saved.get("scaffold-demo")!.roster;
    const units = Object.values(snapshot.instances).filter(
      (instance) => instance.definitionId === "demo-ship-001",
    );
    expect(units).toHaveLength(2);
    const children = units.map((unit) =>
      Object.values(snapshot.instances)
        .filter((instance) => instance.parentInstanceId === unit.id)
        .map((instance) => `${instance.definitionId}:${instance.quantity}`)
        .sort(),
    );
    expect(children[1]).toEqual(children[0]);
    const childIds = units.map((unit) =>
      Object.values(snapshot.instances)
        .filter((instance) => instance.parentInstanceId === unit.id)
        .map((instance) => instance.id),
    );
    expect(childIds[0]!.some((id) => childIds[1]!.includes(id))).toBe(false);
  });

  it("changes Battlefleet, preserves compatible ships and recalculates the whole roster", async () => {
    const fixture = harness([
      "flagship-ship",
      "flagship-model",
      "line-ship",
      "next-battlefleet",
      "next-line-element",
    ]);
    const session = (await openRosterWorkspace("scaffold-demo", fixture.dependencies))!;
    await session.execute({ type: "add", definitionId: "demo-ship-001" });
    await session.execute({ type: "add", definitionId: "demo-ship-002" });

    expect(session.model.summary.points).toBe("405");
    expect(session.model.roster.battlefleets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "demo-empire-line-squadron",
          compatibleShipCount: 1,
          removedShipCount: 1,
        }),
      ]),
    );

    const execution = await session.executeDetailed({
      type: "change-battlefleet",
      battlefleetId: "demo-empire-line-squadron",
    });

    expect(execution.battlefleetChange).toEqual({
      preservedShipCount: 1,
      removedShipCount: 1,
    });
    expect(execution.model.roster).toMatchObject({
      battlefleetId: "demo-empire-line-squadron",
      battlefleet: "Line Squadron",
    });
    expect(execution.model.elements).toHaveLength(1);
    expect(execution.model.elements[0]).toMatchObject({
      definitionId: "demo-line",
      instances: [expect.objectContaining({ id: "line-ship", definitionId: "demo-ship-002" })],
    });
    expect(execution.model.summary).toMatchObject({ points: "55", victoryPoints: "2" });
    expect(fixture.saved.get("scaffold-demo")!).toMatchObject({
      battlefleet: { id: "demo-empire-line-squadron", label: "Line Squadron" },
      requiredElements: [{ id: "demo-line", label: "Line Element", minimum: 1 }],
    });

    const reopened = await openRosterWorkspace("scaffold-demo", fixture.dependencies);
    expect(reopened!.model).toEqual(execution.model);
  });

  it("opens, targets, saves and reloads a Crown Vanguard roster created by KAN-33", async () => {
    const fixture = harness(["crown-ship-1", "crown-model-1"]);
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
      points: "350",
      victoryPoints: "9",
      persistence: "saved-local",
    });
    expect(
      added.elements.find((element) => element.definitionId === "demo-command")!.instances,
    ).toContainEqual(expect.objectContaining({ id: "crown-ship-1", definitionId: asterion.id }));

    const reopened = await openRosterWorkspace(crown.id, dependencies);
    expect(reopened!.model).toEqual(added);
    expect(Object.keys(fixture.saved.get(crown.id)!.roster.instances)).toHaveLength(9);
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
    setupGateway: createDemonstrationRosterSetupGateway(),
    rosterRepository: repository,
    createId: () => ids[index++] ?? `generated-${index}`,
    now: () => "2026-08-02T12:00:00.000Z",
    fallbackRoster: (id) => (id === fallback.id ? fallback : null),
  };
  return { dependencies, failSave, fallback, saveCalls, saved };
}
