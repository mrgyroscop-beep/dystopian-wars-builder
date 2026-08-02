import { describe, expect, it } from "vitest";

import type { DomainCatalog, DomainEntity } from "../../domain/catalog";
import {
  rosterInstanceId,
  type RosterSelectionInstance,
  type RosterSnapshot,
} from "../../domain/roster";
import { createDemonstrationFleetCatalog } from "../../infrastructure/catalog/demonstration-fleet-catalog";
import {
  applyShipEditorCommand,
  materializeShipStructure,
  projectShipEditor,
  type ShipEditorCommandError,
  type ShipEditorReadyReadModel,
} from "./ship-editor";

describe("catalog-driven ship editor application boundary", () => {
  it("materializes one placed structural Model and projects an honest 0/4 instance", () => {
    const fixture = setup();
    const structured = materializeShipStructure(
      fixture.snapshot,
      fixture.catalog,
      fixture.unit,
      fixture.createId,
    );
    const model = ready(
      projectShipEditor(
        structured,
        fixture.catalog,
        fixture.unit.id,
        fixture.unit.definitionId,
        "saved-local",
      ),
    );

    const structural = Object.values(structured.instances).filter(
      (instance) => instance.parentInstanceId === fixture.unit.id,
    );
    expect(structural).toHaveLength(1);
    expect(typeof structural[0]?.placementId).toBe("string");
    expect(structural[0]?.quantity).toBe(1);
    expect(model).toMatchObject({
      dataState: "ready",
      mode: "instance",
      basePoints: "350",
      victoryPoints: "9",
      mandatory: { selected: 0, required: 4 },
      validity: "invalid",
      modelQuantity: { value: 1, fixed: true },
    });
    expect(model.groups.filter((group) => group.control === "exclusive")).toHaveLength(4);
  });

  it("uses fleet-level Kagutsuchi and the real error modifier without auto-applying Magma", () => {
    const fixture = setup();
    let snapshot = materialize(fixture);
    snapshot = choose(snapshot, fixture, "Доктрина флота", "Kagutsuchi Doctrine");

    let model = project(snapshot, fixture);
    expect(model.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Kagutsuchi Doctrine requires Magma Cast Generator.",
          targetGroupId: group(model, "PSA").id,
        }),
      ]),
    );
    expect(option(model, "PSA", "Magma Cast Generator").selectedQuantity).toBe(0);

    snapshot = choose(snapshot, fixture, "PSA", "Magma Cast Generator");
    model = project(snapshot, fixture);
    expect(model.problems.map((problem) => problem.title)).not.toContain(
      "Kagutsuchi Doctrine requires Magma Cast Generator.",
    );
    snapshot = choose(snapshot, fixture, "PSA", "Heavy Battery");
    model = project(snapshot, fixture);
    expect(model.problems.map((problem) => problem.title)).toContain(
      "Kagutsuchi Doctrine requires Magma Cast Generator.",
    );
    expect(option(model, "PSA", "Heavy Battery").selectedQuantity).toBe(1);
    expect(option(model, "PSA", "Magma Cast Generator").selectedQuantity).toBe(0);
  });

  it("applies 0–4 Escort quantity and a calculation-only discount at 4/4", () => {
    const fixture = setup();
    const structured = materialize(fixture);
    const initial = project(structured, fixture);
    const escorts = group(initial, "Escorts");
    const escort = option(initial, "Escorts", "Tanuki Escort");
    const snapshot = applyShipEditorCommand(
      structured,
      fixture.catalog,
      {
        type: "set-choice-quantity",
        instanceId: fixture.unit.id,
        groupId: escorts.id,
        optionId: escort.id,
        quantity: 4,
      },
      fixture.createId,
    );
    const model = project(snapshot, fixture);

    expect(model).toMatchObject({ optionPoints: "40", derivedPoints: "-10", totalPoints: "380" });
    expect(model.breakdown).toContainEqual({
      label: "Производные изменения каталога",
      value: "-10",
    });
    expect(
      Object.values(snapshot.instances).some((instance) =>
        instance.definitionId.includes("discount"),
      ),
    ).toBe(false);
  });

  it("supports catalog-declared variable Model quantity", () => {
    const fixture = setup();
    const structured = materialize(fixture);
    const initial = project(structured, fixture);
    const modelId = initial.modelQuantity.instanceId!;
    const definitionId = structured.instances[modelId]!.definitionId;
    const definition = fixture.catalog.entities[definitionId]!;
    const catalog: DomainCatalog = {
      ...fixture.catalog,
      entities: {
        ...fixture.catalog.entities,
        [definitionId]: {
          ...definition,
          attributes: { ...definition.attributes, "editor.quantity.maximum": "3" },
        },
      },
    };
    const snapshot = applyShipEditorCommand(
      structured,
      catalog,
      { type: "set-model-quantity", instanceId: modelId, quantity: 2 },
      fixture.createId,
    );
    expect(
      ready(
        projectShipEditor(
          snapshot,
          catalog,
          fixture.unit.id,
          fixture.unit.definitionId,
          "saved-local",
        ),
      ).modelQuantity,
    ).toMatchObject({ value: 2, minimum: 1, maximum: 3, fixed: false });
  });

  it("fails closed for unavailable, forged and out-of-range commands", () => {
    const fixture = setup();
    const snapshot = materialize(fixture);
    const model = project(snapshot, fixture);

    expect(() => choose(snapshot, fixture, "PSA", "Sealed Experimental Array")).toThrowError(
      expect.objectContaining({ code: "UNAVAILABLE" }) as ShipEditorCommandError,
    );
    expect(() =>
      applyShipEditorCommand(
        snapshot,
        fixture.catalog,
        {
          type: "replace-exclusive",
          instanceId: fixture.unit.id,
          groupId: group(model, "PSA").id,
          optionId: "forged-placement",
        },
        fixture.createId,
      ),
    ).toThrowError(expect.objectContaining({ code: "UNKNOWN_OPTION" }) as ShipEditorCommandError);
    expect(() =>
      applyShipEditorCommand(
        snapshot,
        fixture.catalog,
        {
          type: "set-choice-quantity",
          instanceId: fixture.unit.id,
          groupId: group(model, "Escorts").id,
          optionId: option(model, "Escorts", "Tanuki Escort").id,
          quantity: 5,
        },
        fixture.createId,
      ),
    ).toThrowError(expect.objectContaining({ code: "OUT_OF_RANGE" }) as ShipEditorCommandError);
  });

  it("reports missing references and unsupported data honestly", () => {
    const fixture = setup();
    expect(
      projectShipEditor(fixture.snapshot, fixture.catalog, null, "missing", "saved-local"),
    ).toMatchObject({ dataState: "missing-reference" });
    const plainUnit = entityByLabel(fixture.catalog, "Line Pattern 002");
    expect(
      projectShipEditor(fixture.snapshot, fixture.catalog, null, plainUnit.id, "saved-local"),
    ).toMatchObject({ dataState: "unsupported-data" });
  });
});

function choose(
  snapshot: RosterSnapshot,
  fixture: ReturnType<typeof setup>,
  groupLabel: string,
  optionLabel: string,
): RosterSnapshot {
  const model = project(snapshot, fixture);
  const targetGroup = group(model, groupLabel);
  return applyShipEditorCommand(
    snapshot,
    fixture.catalog,
    {
      type: "replace-exclusive",
      instanceId: fixture.unit.id,
      groupId: targetGroup.id,
      optionId: option(model, groupLabel, optionLabel).id,
    },
    fixture.createId,
  );
}

function group(model: ShipEditorReadyReadModel, label: string) {
  const found = [...model.groups, ...model.fleetGroups].find(
    (candidate) => candidate.label === label,
  );
  if (!found) throw new Error(`Missing group ${label}`);
  return found;
}

function option(model: ShipEditorReadyReadModel, groupLabel: string, label: string) {
  const found = group(model, groupLabel).options.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`Missing option ${label}`);
  return found;
}

function project(snapshot: RosterSnapshot, fixture: ReturnType<typeof setup>) {
  return ready(
    projectShipEditor(
      snapshot,
      fixture.catalog,
      fixture.unit.id,
      fixture.unit.definitionId,
      "saved-local",
    ),
  );
}

function ready(model: ReturnType<typeof projectShipEditor>): ShipEditorReadyReadModel {
  if (model.dataState !== "ready") throw new Error(`${model.dataState}: ${model.detail}`);
  return model;
}

function materialize(fixture: ReturnType<typeof setup>) {
  return materializeShipStructure(
    fixture.snapshot,
    fixture.catalog,
    fixture.unit,
    fixture.createId,
  );
}

function setup() {
  const catalog = createDemonstrationFleetCatalog();
  const battlefleet = entityByLabel(catalog, "Harbour Patrol");
  const element = entityByLabel(catalog, "Flagship Element");
  const unitDefinition = entityByLabel(catalog, "Akita Demonstrator");
  const elementPlacement = Object.values(catalog.placements).find(
    (candidate) => candidate.ownerId === battlefleet.id && candidate.definitionId === element.id,
  )!;
  const unitPlacement = Object.values(catalog.placements).find(
    (candidate) => candidate.ownerId === element.id && candidate.definitionId === unitDefinition.id,
  )!;
  const root = selection("fleet", battlefleet.id, null, null, "fleet");
  const elementInstance = selection("element", element.id, elementPlacement.id, root.id, root.id);
  const unit = selection(
    "akita-instance",
    unitDefinition.id,
    unitPlacement.id,
    elementInstance.id,
    root.id,
  );
  const snapshot: RosterSnapshot = {
    contractVersion: 1,
    id: "editor-test",
    catalogContentVersion: catalog.contentVersion,
    rootInstanceIds: [root.id],
    instances: { [root.id]: root, [elementInstance.id]: elementInstance, [unit.id]: unit },
  };
  let index = 0;
  return { catalog, unit, snapshot, createId: () => `editor-child-${++index}` };
}

function entityByLabel(catalog: DomainCatalog, label: string): DomainEntity {
  const found = Object.values(catalog.entities).find(
    (candidate) => candidate.label.plainText === label,
  );
  if (!found) throw new Error(`Missing entity ${label}`);
  return found;
}

function selection(
  rawId: string,
  definitionId: string,
  placementId: string | null,
  parentInstanceId: string | null,
  forceInstanceId: string,
): RosterSelectionInstance {
  return {
    contractVersion: 1,
    id: rosterInstanceId(rawId),
    definitionId: definitionId as RosterSelectionInstance["definitionId"],
    placementId: placementId as RosterSelectionInstance["placementId"],
    slotId: null,
    parentInstanceId: parentInstanceId as RosterSelectionInstance["parentInstanceId"],
    forceInstanceId: rosterInstanceId(forceInstanceId),
    quantity: 1,
  };
}
