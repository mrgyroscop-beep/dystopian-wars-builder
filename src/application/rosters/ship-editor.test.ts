import { describe, expect, it } from "vitest";

import { rosterInstanceId, type RosterSnapshot } from "../../domain/roster";
import { createDemonstrationFleetCatalog } from "../../infrastructure/catalog/demonstration-fleet-catalog";
import {
  AKITA_DEMONSTRATOR_ID,
  AKITA_ESCORT_DISCOUNT_ID,
  AKITA_MODEL_ID,
  applyShipEditorCommand,
  materializeShipStructure,
  projectShipEditor,
  type ShipEditorCommandError,
} from "./ship-editor";

describe("Akita ship editor application boundary", () => {
  it("materializes one free structural Model and projects an honest 0/4 instance", () => {
    const fixture = setup();
    const structured = materializeShipStructure(fixture.snapshot, fixture.unit, fixture.createId);
    const model = projectShipEditor(structured, fixture.catalog, fixture.unit.id, "saved-local")!;

    expect(
      Object.values(structured.instances).filter(
        (instance) => instance.definitionId === AKITA_MODEL_ID,
      ),
    ).toHaveLength(1);
    expect(model).toMatchObject({
      mode: "instance",
      basePoints: "350",
      victoryPoints: "9",
      mandatory: { selected: 0, required: 4 },
      validity: "invalid",
    });
    expect(model.groups.filter((group) => group.control === "exclusive")).toHaveLength(4);
  });

  it("replaces exclusive choices atomically and exposes Kagutsuchi → Magma without auto-apply", () => {
    const fixture = setup();
    let snapshot = materializeShipStructure(fixture.snapshot, fixture.unit, fixture.createId);
    snapshot = choose(snapshot, fixture, "fps-1", "demo-akita-kagutsuchi");

    let model = projectShipEditor(snapshot, fixture.catalog, fixture.unit.id, "saved-local")!;
    expect(model.problems).toContainEqual(
      expect.objectContaining({ id: "kagutsuchi-requires-magma", targetGroupId: "psa" }),
    );
    expect(model.groups.find((group) => group.id === "psa")!.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "demo-akita-magma-cast", selectedQuantity: 0 }),
      ]),
    );

    snapshot = choose(snapshot, fixture, "psa", "demo-akita-magma-cast");
    model = projectShipEditor(snapshot, fixture.catalog, fixture.unit.id, "saved-local")!;
    expect(model.problems.map((problem) => problem.id)).not.toContain("kagutsuchi-requires-magma");
    snapshot = choose(snapshot, fixture, "psa", "demo-akita-heavy-battery");
    model = projectShipEditor(snapshot, fixture.catalog, fixture.unit.id, "saved-local")!;
    expect(model.problems.map((problem) => problem.id)).toContain("kagutsuchi-requires-magma");
    expect(
      model.groups
        .find((group) => group.id === "psa")!
        .options.filter((option) => option.selectedQuantity > 0),
    ).toEqual([expect.objectContaining({ id: "demo-akita-heavy-battery" })]);
  });

  it("applies 0–4 Escort quantity and a calculation-only discount at 4/4", () => {
    const fixture = setup();
    const structured = materializeShipStructure(fixture.snapshot, fixture.unit, fixture.createId);
    const snapshot = applyShipEditorCommand(
      structured,
      fixture.catalog,
      {
        type: "set-choice-quantity",
        instanceId: fixture.unit.id,
        groupId: "escorts",
        optionId: "demo-akita-tanuki-escort",
        quantity: 4,
      },
      fixture.createId,
    );
    const model = projectShipEditor(snapshot, fixture.catalog, fixture.unit.id, "saved-local")!;

    expect(model).toMatchObject({ optionPoints: "40", derivedPoints: "-10", totalPoints: "380" });
    expect(model.breakdown).toContainEqual({
      label: "Скрытая скидка Escort 4/4",
      value: "-10",
    });
    expect(
      Object.values(snapshot.instances).filter(
        (instance) => instance.definitionId === AKITA_ESCORT_DISCOUNT_ID,
      ),
    ).toHaveLength(1);
  });

  it("fails closed for unavailable, forged and out-of-range commands", () => {
    const fixture = setup();
    const snapshot = materializeShipStructure(fixture.snapshot, fixture.unit, fixture.createId);

    expect(() => choose(snapshot, fixture, "psa", "demo-akita-sealed-array")).toThrowError(
      expect.objectContaining({ code: "UNAVAILABLE" }) as ShipEditorCommandError,
    );
    expect(() => choose(snapshot, fixture, "psa", "forged-option")).toThrowError(
      expect.objectContaining({ code: "UNKNOWN_OPTION" }) as ShipEditorCommandError,
    );
    expect(() =>
      applyShipEditorCommand(
        snapshot,
        fixture.catalog,
        {
          type: "set-choice-quantity",
          instanceId: fixture.unit.id,
          groupId: "escorts",
          optionId: "demo-akita-tanuki-escort",
          quantity: 5,
        },
        fixture.createId,
      ),
    ).toThrowError(expect.objectContaining({ code: "OUT_OF_RANGE" }) as ShipEditorCommandError);
  });
});

function choose(
  snapshot: RosterSnapshot,
  fixture: ReturnType<typeof setup>,
  groupId: "psa" | "fps-1" | "fps-2" | "fps-3",
  optionId: string,
): RosterSnapshot {
  return applyShipEditorCommand(
    snapshot,
    fixture.catalog,
    {
      type: "replace-exclusive",
      instanceId: fixture.unit.id,
      groupId,
      optionId,
    },
    fixture.createId,
  );
}

function setup() {
  const catalog = createDemonstrationFleetCatalog();
  const unit = {
    contractVersion: 1 as const,
    id: rosterInstanceId("akita-instance"),
    definitionId: AKITA_DEMONSTRATOR_ID as never,
    placementId: null,
    slotId: null,
    parentInstanceId: null,
    forceInstanceId: rosterInstanceId("akita-instance"),
    quantity: 1,
  };
  const snapshot: RosterSnapshot = {
    contractVersion: 1,
    id: "editor-test",
    catalogContentVersion: catalog.contentVersion,
    rootInstanceIds: [unit.id],
    instances: { [unit.id]: unit },
  };
  let index = 0;
  return {
    catalog,
    unit,
    snapshot,
    createId: () => `editor-child-${++index}`,
  };
}
