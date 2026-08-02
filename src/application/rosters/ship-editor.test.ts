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
    expect(model.problems).toHaveLength(4);
    expect(new Set(model.problems.map((problem) => problem.targetGroupLabel)).size).toBe(4);
    expect(model.problems.every((problem) => problem.title.endsWith("требуется выбор"))).toBe(true);
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
    const placementId = structured.instances[modelId]!.placementId!;
    const placement = fixture.catalog.placements[placementId]!;
    const catalog: DomainCatalog = {
      ...fixture.catalog,
      placements: {
        ...fixture.catalog.placements,
        [placementId]: {
          ...placement,
          overlay: {
            ...placement.overlay,
            cardinality: {
              contractVersion: 1,
              minimum: { contractVersion: 1, state: "value", value: "1" },
              maximum: { contractVersion: 1, state: "value", value: "3" },
              effective: "deferred-to-kan-32",
            },
          },
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

  it("removes effective hidden and helper slots from controls while failing closed honestly", () => {
    const fixture = setup();
    let snapshot = materialize(fixture);
    const initial = project(snapshot, fixture);
    const hiddenGroup = group(initial, "FPS 2");
    snapshot = choose(snapshot, fixture, "FPS 2", "Rocket Battery");
    const modifierTemplate = Object.values(fixture.catalog.entities).find(
      (entity): entity is Extract<DomainEntity, { kind: "Modifier" }> => entity.kind === "Modifier",
    )!;
    const modifierId = "test-effective-hidden" as DomainEntity["id"];
    const hiddenCatalog: DomainCatalog = {
      ...fixture.catalog,
      entities: {
        ...fixture.catalog.entities,
        [modifierId]: {
          ...modifierTemplate,
          id: modifierId,
          conditionIds: [],
          expression: {
            ...modifierTemplate.expression,
            field: "hidden",
            value: "true",
            evaluable: true,
            unevaluableReasons: [],
          },
        },
      },
      slots: {
        ...fixture.catalog.slots,
        [hiddenGroup.id]: {
          ...fixture.catalog.slots[hiddenGroup.id]!,
          modifierIds: [modifierId],
        },
      },
    };
    const hidden = project(snapshot, { ...fixture, catalog: hiddenCatalog });
    expect(hidden.groups.map((candidate) => candidate.label)).not.toContain("FPS 2");
    expect(hidden.mandatory).toEqual({ selected: 0, required: 3 });
    expect(hidden.problems.some((problem) => problem.detail.includes("selected option"))).toBe(
      true,
    );

    const helperGroup = group(initial, "FPS 3");
    const helperCatalog: DomainCatalog = {
      ...fixture.catalog,
      slots: {
        ...fixture.catalog.slots,
        [helperGroup.id]: { ...fixture.catalog.slots[helperGroup.id]!, helper: true },
      },
    };
    const helper = project(materialize(fixture), { ...fixture, catalog: helperCatalog });
    expect(helper.groups.map((candidate) => candidate.label)).not.toContain("FPS 3");
    expect(helper.mandatory.required).toBe(3);

    const effectiveModifier = hiddenCatalog.entities[modifierId] as Extract<
      DomainEntity,
      { kind: "Modifier" }
    >;
    const unknownModifier: Extract<DomainEntity, { kind: "Modifier" }> = {
      ...effectiveModifier,
      expression: { ...effectiveModifier.expression, value: "unknown" },
    };
    const unknownCatalog: DomainCatalog = {
      ...hiddenCatalog,
      entities: {
        ...hiddenCatalog.entities,
        [modifierId]: unknownModifier,
      },
    };
    const unknown = project(materialize(fixture), { ...fixture, catalog: unknownCatalog });
    expect(unknown.groups.map((candidate) => candidate.label)).not.toContain("FPS 2");
    expect(unknown.validity).toBe("indeterminate");
  });

  it("projects exactly four mandatory problems in preview and none after 4/4", () => {
    const fixture = setup();
    let snapshot = materialize(fixture);
    expect(
      project(snapshot, fixture).problems.filter((problem) => problem.id.startsWith("mandatory:")),
    ).toHaveLength(4);
    for (const [groupLabel, optionLabel] of [
      ["PSA", "Magma Cast Generator"],
      ["FPS 1", "Fury Generator"],
      ["FPS 2", "Rocket Battery"],
      ["FPS 3", "Shield Generator"],
    ] as const)
      snapshot = choose(snapshot, fixture, groupLabel, optionLabel);
    const configured = project(snapshot, fixture);
    expect(configured.mandatory).toEqual({ selected: 4, required: 4 });
    expect(configured.problems.filter((problem) => problem.id.startsWith("mandatory:"))).toEqual(
      [],
    );
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

  it("projects ordered base and effective profile data with complete weapon rows", () => {
    const fixture = setup();
    const preview = ready(
      projectShipEditor(
        fixture.snapshot,
        fixture.catalog,
        null,
        fixture.unit.definitionId,
        "saved-local",
      ),
    );
    expect(preview.profileRules.variant).toBe("base");
    expect(preview.profileRules.sections.map((section) => section.label)).toEqual([
      "Model",
      "Properties",
      "Systems",
    ]);
    expect(preview.profileRules.rules.map((rule) => rule.label)).toEqual(["Torrent", "Submerged"]);

    let snapshot = materialize(fixture);
    snapshot = choose(snapshot, fixture, "PSA", "Heavy Battery");
    snapshot = choose(snapshot, fixture, "FPS 1", "Torpedo Battery");
    const configured = project(snapshot, fixture);
    expect(configured.profileRules.variant).toBe("effective");
    const heavy = configured.profileRules.weapons.find(
      (weapon) => weapon.weapon === "Heavy Battery",
    );
    expect(heavy).toBeDefined();
    expect(heavy?.arc).not.toBe("—");
    expect(heavy?.close).not.toBe("—");
    expect(heavy?.standard).not.toBe("—");
    expect(heavy?.extreme).not.toBe("—");
    expect(configured.profileRules.weapons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          weapon: "Heavy Battery",
          qualities: "Torrent",
          provenance: "PSA",
        }),
        expect.objectContaining({ weapon: "Torpedo Battery", provenance: "FPS 1" }),
      ]),
    );
  });

  it("preserves one configured weapon row per slot when definitions repeat", () => {
    const fixture = setup();
    const structured = materialize(fixture);
    const initial = project(structured, fixture);
    const psa = group(initial, "PSA");
    const fps = group(initial, "FPS 1");
    const heavy = entityByLabel(fixture.catalog, "Heavy Battery");
    const heavyPlacement = option(initial, "PSA", "Heavy Battery");
    const repeatedPlacement = option(initial, "FPS 1", "Torpedo Battery");
    const sourcePlacement = fixture.catalog.placements[repeatedPlacement.id]!;
    const catalog: DomainCatalog = {
      ...fixture.catalog,
      placements: {
        ...fixture.catalog.placements,
        [sourcePlacement.id]: { ...sourcePlacement, definitionId: heavy.id },
      },
    };
    let snapshot = applyShipEditorCommand(
      structured,
      catalog,
      {
        type: "replace-exclusive",
        instanceId: fixture.unit.id,
        groupId: psa.id,
        optionId: heavyPlacement.id,
      },
      fixture.createId,
    );
    snapshot = applyShipEditorCommand(
      snapshot,
      catalog,
      {
        type: "replace-exclusive",
        instanceId: fixture.unit.id,
        groupId: fps.id,
        optionId: repeatedPlacement.id,
      },
      fixture.createId,
    );

    const configured = ready(
      projectShipEditor(
        snapshot,
        catalog,
        fixture.unit.id,
        fixture.unit.definitionId,
        "saved-local",
      ),
    );
    expect(
      configured.profileRules.weapons
        .filter((weapon) => weapon.weapon === "Heavy Battery")
        .map((weapon) => weapon.provenance),
    ).toEqual(["PSA", "FPS 1"]);
  });

  it("diagnoses unknown slot provenance instead of guessing it from the label", () => {
    const fixture = setup();
    let snapshot = materialize(fixture);
    snapshot = choose(snapshot, fixture, "PSA", "Heavy Battery");
    const psa = group(project(snapshot, fixture), "PSA");
    const sourceSlot = fixture.catalog.slots[psa.id]!;
    const catalog: DomainCatalog = {
      ...fixture.catalog,
      slots: {
        ...fixture.catalog.slots,
        [sourceSlot.id]: {
          ...sourceSlot,
          label: { ...sourceSlot.label, plainText: "PSA" },
          semantics: { ...sourceSlot.semantics, profileRole: null },
        },
      },
    };
    const projected = ready(
      projectShipEditor(
        snapshot,
        catalog,
        fixture.unit.id,
        fixture.unit.definitionId,
        "saved-local",
      ),
    );
    expect(
      projected.profileRules.weapons.find((weapon) => weapon.weapon === "Heavy Battery")
        ?.provenance,
    ).toBeNull();
    expect(projected.profileRules.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PROFILE_SLOT_SEMANTICS_UNKNOWN" }),
    );
  });

  it("fails rule descriptions closed when the source catalog version mismatches", () => {
    const fixture = setup();
    const snapshot = { ...materialize(fixture), catalogContentVersion: "older-catalog" };
    const model = project(snapshot, fixture);
    expect(model.profileRules.versionState).toBe("mismatch");
    expect(model.profileRules.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "synthetic-rule-torrent",
          available: false,
          description: null,
        }),
      ]),
    );
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
