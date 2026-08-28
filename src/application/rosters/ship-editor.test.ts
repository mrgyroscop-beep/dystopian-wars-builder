import { describe, expect, it } from "vitest";

import {
  entityId,
  placementId,
  slotId,
  sourceNodeId,
  toSafePresentation,
  type DomainCatalog,
  type DomainEntity,
  type Placement,
} from "../../domain/catalog";
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
  it("materializes one structural Model with the minimum valid base loadout", () => {
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
      mandatory: { selected: 4, required: 4 },
      validity: "valid",
      modelQuantity: { value: 1, fixed: true },
    });
    expect(model.groups.filter((group) => group.control === "exclusive")).toHaveLength(4);
    expect(model.problems).toEqual([]);
  });

  it("uses fleet-level Kagutsuchi and keeps the base loadout user-editable", () => {
    const fixture = setup();
    let snapshot = materialize(fixture);
    expect(option(project(snapshot, fixture), "PSA", "Magma Cast Generator").selectedQuantity).toBe(
      1,
    );
    snapshot = choose(snapshot, fixture, "PSA", "Heavy Battery");
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

  it("materializes and removes a Battlefleet-conditioned automatic option", () => {
    const fixture = setup();
    const testId = (tag: string, upstreamId: string) =>
      entityId(sourceNodeId("ship-editor-test", tag, upstreamId));
    const optionId = testId("selectionEntry", "automatic-escort-discount");
    const costId = testId("cost", "automatic-escort-discount-cost");
    const minimumId = testId("constraint", "automatic-escort-discount-minimum");
    const maximumId = testId("constraint", "automatic-escort-discount-maximum");
    const conditionId = testId("condition", "automatic-escort-discount-condition");
    const modifierId = testId("modifier", "automatic-escort-discount-modifier");
    const optionTemplate = entityByLabel(fixture.catalog, "Repair Crane");
    const costTemplate = Object.values(fixture.catalog.entities).find(
      (candidate) => candidate.kind === "Cost",
    )!;
    const constraintTemplate = Object.values(fixture.catalog.entities).find(
      (candidate) => candidate.kind === "Constraint",
    )!;
    const conditionTemplate = Object.values(fixture.catalog.entities).find(
      (candidate) => candidate.id === "demo-akita-four-escorts",
    )! as Extract<DomainEntity, { kind: "Condition" }>;
    const modifierTemplate = Object.values(fixture.catalog.entities).find(
      (candidate) => candidate.id === "demo-akita-escort-discount-modifier",
    )! as Extract<DomainEntity, { kind: "Modifier" }>;
    const escort = entityByLabel(fixture.catalog, "Tanuki Escort");
    const modelPlacement = Object.values(fixture.catalog.placements).find(
      (candidate) =>
        candidate.ownerId === fixture.unit.definitionId &&
        fixture.catalog.entities[candidate.definitionId!]?.kind === "Model",
    )!;
    const placementIdValue = placementId(
      fixture.unit.definitionId,
      sourceNodeId("ship-editor-test", "selectionEntry", "automatic-escort-discount-placement"),
      999,
    );
    const minimum = {
      ...constraintTemplate,
      id: minimumId,
      expression: {
        ...constraintTemplate.expression,
        operator: "min" as const,
        field: "selections",
        scope: "parent",
        value: "0",
        flags: { automatic: "true" },
      },
      modifierIds: [],
      conditionIds: [],
    };
    const maximum = {
      ...constraintTemplate,
      id: maximumId,
      expression: {
        ...constraintTemplate.expression,
        operator: "max" as const,
        field: "selections",
        scope: "parent",
        value: "1",
        flags: {},
      },
      modifierIds: [],
      conditionIds: [],
    };
    const condition = {
      ...conditionTemplate,
      id: conditionId,
      expression: {
        ...conditionTemplate.expression,
        operator: "atLeast" as const,
        field: "selections",
        scope: "unit",
        value: "1",
        references: [escort.id],
        referenceResolutions: [],
      },
    };
    const modifier = {
      ...modifierTemplate,
      id: modifierId,
      expression: {
        ...modifierTemplate.expression,
        operator: "set" as const,
        field: minimumId,
        value: "1",
      },
      conditionIds: [conditionId],
      repeatIds: [],
    };
    const discountCost = {
      ...costTemplate,
      id: costId,
      amount: { contractVersion: 1 as const, state: "value" as const, value: "-5" },
      semantics: {
        ...costTemplate.semantics,
        amount: { contractVersion: 1 as const, state: "value" as const, value: "-5" },
        resource: "points" as const,
        role: "delta" as const,
      },
    };
    const automaticOption = {
      ...optionTemplate,
      id: optionId,
      kind: "Option" as const,
      label: toSafePresentation("Escort discount"),
      attributes: { ...optionTemplate.attributes, hidden: "true" },
      costIds: [costId],
      constraintIds: [minimumId, maximumId],
      modifierIds: [modifierId],
      slotIds: [],
    } as DomainEntity;
    const automaticPlacement: Placement = {
      ...modelPlacement,
      id: placementIdValue,
      ownerId: fixture.unit.definitionId,
      definitionId: optionId,
      slotId: null,
      order: 999,
      overlay: {
        ...modelPlacement.overlay,
        attributes: { hidden: "true" },
        cardinality: {
          contractVersion: 1 as const,
          minimum: { contractVersion: 1 as const, state: "zero" as const, value: "0" },
          maximum: { contractVersion: 1 as const, state: "value" as const, value: "1" },
          effective: "deferred-to-kan-32" as const,
        },
        costIds: [costId],
        constraintIds: [minimumId, maximumId],
        conditionIds: [],
        modifierIds: [modifierId],
        repeatIds: [],
      },
    };
    const catalog: DomainCatalog = {
      ...fixture.catalog,
      entities: {
        ...fixture.catalog.entities,
        [optionId]: automaticOption,
        [costId]: discountCost,
        [minimumId]: minimum,
        [maximumId]: maximum,
        [conditionId]: condition,
        [modifierId]: modifier,
      },
      placements: {
        ...fixture.catalog.placements,
        [placementIdValue]: automaticPlacement,
      },
    };
    const configured = { ...fixture, catalog };
    let snapshot = materialize(configured);
    let model = project(snapshot, configured);
    const initialPoints = Number(model.totalPoints);
    const escorts = group(model, "Escorts");
    const escortOption = option(model, "Escorts", "Tanuki Escort");

    snapshot = applyShipEditorCommand(
      snapshot,
      catalog,
      {
        type: "set-choice-quantity",
        instanceId: fixture.unit.id,
        groupId: escorts.id,
        optionId: escortOption.id,
        quantity: 2,
      },
      fixture.createId,
    );
    model = project(snapshot, configured);
    expect(
      Object.values(snapshot.instances).filter((instance) => instance.definitionId === optionId),
    ).toHaveLength(1);
    expect(Number(model.totalPoints)).toBe(initialPoints + 15);

    snapshot = applyShipEditorCommand(
      snapshot,
      catalog,
      {
        type: "set-choice-quantity",
        instanceId: fixture.unit.id,
        groupId: escorts.id,
        optionId: escortOption.id,
        quantity: 0,
      },
      fixture.createId,
    );
    expect(
      Object.values(snapshot.instances).filter((instance) => instance.definitionId === optionId),
    ).toHaveLength(0);
  });

  it("shows and edits a standalone option linked directly from the Unit", () => {
    const fixture = setup();
    const templateOption = entityByLabel(fixture.catalog, "Tanuki Escort");
    const templateSlot = Object.values(fixture.catalog.slots).find(
      (candidate) => candidate.label.plainText === "Escorts",
    )!;
    const templatePlacement = Object.values(fixture.catalog.placements).find(
      (candidate) => candidate.definitionId === templateOption.id,
    )!;
    const definitionSourceId = sourceNodeId("test", "selectionEntry", "supply-escorts");
    const definitionId = entityId(definitionSourceId);
    const optionSlotId = slotId(definitionId);
    const optionPlacementId = placementId(
      fixture.unit.definitionId,
      sourceNodeId("test", "entryLink", "supply-escorts-link"),
      99,
      "reference",
    );
    const label = toSafePresentation("Supply Escorts");
    const catalog: DomainCatalog = {
      ...fixture.catalog,
      entities: {
        ...fixture.catalog.entities,
        [definitionId]: {
          ...templateOption,
          id: definitionId,
          kind: "Escort",
          label,
          labels: {
            ...templateOption.labels,
            canonicalLabel: label.plainText,
            fallbackLabel: label.plainText,
            sourceLabel: label.plainText,
          },
          identity: {
            ...templateOption.identity,
            canonicalId: definitionId,
            sourceNodeId: definitionSourceId,
          },
          slotIds: [optionSlotId],
        },
      },
      placements: {
        ...fixture.catalog.placements,
        [optionPlacementId]: {
          ...templatePlacement,
          id: optionPlacementId,
          ownerId: fixture.unit.definitionId,
          definitionId,
          slotId: null,
          order: 99,
          linkKind: "reference",
          overlay: {
            ...templatePlacement.overlay,
            cardinality: {
              contractVersion: 1,
              effective: "deferred-to-kan-32",
              minimum: { contractVersion: 1, state: "zero", value: "0" },
              maximum: { contractVersion: 1, state: "value", value: "2" },
            },
          },
        },
      },
      slots: {
        ...fixture.catalog.slots,
        [optionSlotId]: {
          ...templateSlot,
          id: optionSlotId,
          ownerId: definitionId,
          label,
          placementIds: [],
          optionPlacementIds: [],
        },
      },
    };
    const tailored = { ...fixture, catalog };
    let snapshot = materialize(tailored);
    let model = project(snapshot, tailored);
    const standalone = group(model, "Supply Escorts");

    expect(standalone.options).toEqual([
      expect.objectContaining({ id: optionPlacementId, label: "Supply Escorts" }),
    ]);

    snapshot = applyShipEditorCommand(
      snapshot,
      catalog,
      {
        type: "set-choice-quantity",
        instanceId: fixture.unit.id,
        groupId: standalone.id,
        optionId: optionPlacementId,
        quantity: 2,
      },
      fixture.createId,
    );
    model = project(snapshot, tailored);
    expect(option(model, "Supply Escorts", "Supply Escorts").selectedQuantity).toBe(2);
  });

  it("reads variable Model quantity from selection constraints instead of placeholder cardinality", () => {
    const fixture = setup();
    const initialStructure = materialize(fixture);
    const initialModelId = project(initialStructure, fixture).modelQuantity.instanceId!;
    const placementId = initialStructure.instances[initialModelId]!.placementId!;
    const placement = fixture.catalog.placements[placementId]!;
    const modelDefinition = fixture.catalog.entities[placement.definitionId!]!;
    const constraintTemplate = Object.values(fixture.catalog.entities).find(
      (entity): entity is Extract<DomainEntity, { kind: "Constraint" }> =>
        entity.kind === "Constraint",
    )!;
    const minimumId = entityId(sourceNodeId("test", "constraint", "model-count-min"));
    const maximumId = entityId(sourceNodeId("test", "constraint", "model-count-max"));
    const constraint = (
      id: DomainEntity["id"],
      operator: "min" | "max",
      value: string,
    ): Extract<DomainEntity, { kind: "Constraint" }> => ({
      ...constraintTemplate,
      id,
      identity: { ...constraintTemplate.identity, canonicalId: id },
      conditionIds: [],
      modifierIds: [],
      expression: {
        ...constraintTemplate.expression,
        operator,
        field: "selections",
        scope: "parent",
        value,
        evaluable: true,
        unevaluableReasons: [],
      },
    });
    const catalog: DomainCatalog = {
      ...fixture.catalog,
      entities: {
        ...fixture.catalog.entities,
        [minimumId]: constraint(minimumId, "min", "2"),
        [maximumId]: constraint(maximumId, "max", "6"),
        [modelDefinition.id]: {
          ...modelDefinition,
          constraintIds: [minimumId, maximumId],
        },
      },
      placements: {
        ...fixture.catalog.placements,
        [placementId]: {
          ...placement,
          overlay: {
            ...placement.overlay,
            cardinality: {
              contractVersion: 1,
              minimum: { contractVersion: 1, state: "value", value: "1" },
              maximum: { contractVersion: 1, state: "value", value: "1" },
              effective: "deferred-to-kan-32",
            },
            constraintIds: [minimumId, maximumId],
          },
        },
      },
    };
    const tailored = { ...fixture, catalog };
    const structured = materialize(tailored);
    const initial = project(structured, tailored);
    const modelId = initial.modelQuantity.instanceId!;
    expect(initial.modelQuantity).toMatchObject({
      value: 2,
      minimum: 2,
      maximum: 6,
      fixed: false,
    });
    const snapshot = applyShipEditorCommand(
      structured,
      catalog,
      { type: "set-model-quantity", instanceId: modelId, quantity: 4 },
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
    ).toMatchObject({ value: 4, minimum: 2, maximum: 6, fixed: false });
  });

  it("changes a valid Model quantity when an unrelated roster branch is indeterminate", () => {
    const fixture = setup();
    const initialStructure = materialize(fixture);
    const initialModelId = project(initialStructure, fixture).modelQuantity.instanceId!;
    const modelPlacement =
      fixture.catalog.placements[initialStructure.instances[initialModelId]!.placementId!]!;
    const modelDefinition = fixture.catalog.entities[modelPlacement.definitionId!]!;
    const constraintTemplate = Object.values(fixture.catalog.entities).find(
      (entity): entity is Extract<DomainEntity, { kind: "Constraint" }> =>
        entity.kind === "Constraint",
    )!;
    const minimumId = entityId(sourceNodeId("test", "constraint", "unrelated-model-min"));
    const maximumId = entityId(sourceNodeId("test", "constraint", "unrelated-model-max"));
    const constraint = (
      id: DomainEntity["id"],
      operator: "min" | "max",
      value: string,
    ): Extract<DomainEntity, { kind: "Constraint" }> => ({
      ...constraintTemplate,
      id,
      identity: { ...constraintTemplate.identity, canonicalId: id },
      conditionIds: [],
      modifierIds: [],
      expression: {
        ...constraintTemplate.expression,
        operator,
        field: "selections",
        scope: "parent",
        value,
        evaluable: true,
        unevaluableReasons: [],
      },
    });
    const catalog: DomainCatalog = {
      ...fixture.catalog,
      entities: {
        ...fixture.catalog.entities,
        [minimumId]: constraint(minimumId, "min", "1"),
        [maximumId]: constraint(maximumId, "max", "3"),
        [modelDefinition.id]: {
          ...modelDefinition,
          constraintIds: [minimumId, maximumId],
        },
      },
      placements: {
        ...fixture.catalog.placements,
        [modelPlacement.id]: {
          ...modelPlacement,
          overlay: {
            ...modelPlacement.overlay,
            constraintIds: [minimumId, maximumId],
          },
        },
      },
    };
    const tailored = { ...fixture, catalog };
    const structured = materialize(tailored);
    const modelId = project(structured, tailored).modelQuantity.instanceId!;
    const missingDefinitionId = entityId(sourceNodeId("test", "unit", "missing-definition"));
    const unrelatedId = rosterInstanceId("unrelated-indeterminate");
    const snapshot: RosterSnapshot = {
      ...structured,
      rootInstanceIds: [...structured.rootInstanceIds, unrelatedId],
      instances: {
        ...structured.instances,
        [unrelatedId]: {
          contractVersion: 1,
          id: unrelatedId,
          definitionId: missingDefinitionId,
          placementId: null,
          slotId: null,
          parentInstanceId: null,
          forceInstanceId: unrelatedId,
          quantity: 1,
        },
      },
    };

    const updated = applyShipEditorCommand(
      snapshot,
      catalog,
      { type: "set-model-quantity", instanceId: modelId, quantity: 2 },
      fixture.createId,
    );

    expect(updated.instances[modelId]?.quantity).toBe(2);
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
    expect(hidden.mandatory).toEqual({ selected: 3, required: 3 });
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

  it("hides technical attachment options but keeps an already selected one visible", () => {
    const fixture = setup();
    const snapshot = materialize(fixture);
    const initial = project(snapshot, fixture);
    const attachments = group(initial, "Attachments");
    const repairCrane = option(initial, "Attachments", "Repair Crane");
    const sourcePlacement = fixture.catalog.placements[repairCrane.id]!;
    const hiddenCatalog: DomainCatalog = {
      ...fixture.catalog,
      placements: {
        ...fixture.catalog.placements,
        [repairCrane.id]: {
          ...sourcePlacement,
          overlay: {
            ...sourcePlacement.overlay,
            attributes: { ...sourcePlacement.overlay.attributes, hidden: "true" },
            modifierIds: [],
          },
        },
      },
    };
    const tailored = { ...fixture, catalog: hiddenCatalog };

    expect(project(snapshot, tailored).groups.map((candidate) => candidate.label)).not.toContain(
      "Attachments",
    );

    const selected = applyShipEditorCommand(
      snapshot,
      fixture.catalog,
      {
        type: "set-choice-quantity",
        instanceId: fixture.unit.id,
        groupId: attachments.id,
        optionId: repairCrane.id,
        quantity: 1,
      },
      fixture.createId,
    );
    const selectedModel = project(selected, tailored);
    expect(option(selectedModel, "Attachments", "Repair Crane")).toMatchObject({
      selectedQuantity: 1,
      availability: "unavailable",
      reason: "Опция недоступна в текущем составе.",
    });
    expect(option(selectedModel, "Attachments", "Repair Crane").reason).not.toContain(
      "OPTION_HIDDEN",
    );
  });

  it("keeps optional maximum-one alternatives neutral and replaceable at capacity", () => {
    const fixture = setup();
    const attachmentSlot = Object.values(fixture.catalog.slots).find(
      (candidate) => candidate.label.plainText === "Attachments",
    )!;
    const repairCrane = entityByLabel(fixture.catalog, "Repair Crane");
    const repairPlacement = fixture.catalog.placements[attachmentSlot.optionPlacementIds[0]!]!;
    const shieldSourceId = sourceNodeId("test", "selectionEntry", "shield-generator");
    const shieldId = entityId(shieldSourceId);
    const shieldPlacementId = placementId(
      attachmentSlot.ownerId,
      sourceNodeId("test", "selectionEntry", "shield-generator-placement"),
      1,
      "ownership",
    );
    const shieldLabel = toSafePresentation("Shield Generator");
    const ruleTemplate = entityByLabel(fixture.catalog, "Torrent");
    const shieldRuleSourceId = sourceNodeId("test", "rule", "shield-generator");
    const shieldRuleId = entityId(shieldRuleSourceId);
    const shieldDescription = toSafePresentation("Shield Generator protects its unit.");
    const catalog: DomainCatalog = {
      ...fixture.catalog,
      entities: {
        ...fixture.catalog.entities,
        [shieldId]: {
          ...repairCrane,
          id: shieldId,
          label: shieldLabel,
          labels: {
            ...repairCrane.labels,
            canonicalLabel: shieldLabel.plainText,
            fallbackLabel: shieldLabel.plainText,
            sourceLabel: shieldLabel.plainText,
          },
          identity: {
            ...repairCrane.identity,
            canonicalId: shieldId,
            sourceNodeId: shieldSourceId,
          },
        },
        [shieldRuleId]: {
          ...ruleTemplate,
          id: shieldRuleId,
          kind: "Rule",
          label: shieldLabel,
          description: shieldDescription,
          labels: {
            ...ruleTemplate.labels,
            canonicalLabel: shieldLabel.plainText,
            fallbackLabel: shieldLabel.plainText,
            sourceLabel: shieldLabel.plainText,
          },
          identity: {
            ...ruleTemplate.identity,
            canonicalId: shieldRuleId,
            sourceNodeId: shieldRuleSourceId,
          },
        },
      },
      placements: {
        ...fixture.catalog.placements,
        [shieldPlacementId]: {
          ...repairPlacement,
          id: shieldPlacementId,
          definitionId: shieldId,
          order: 1,
          targetSourceNodeId: shieldSourceId,
        },
      },
      slots: {
        ...fixture.catalog.slots,
        [attachmentSlot.id]: {
          ...attachmentSlot,
          placementIds: [...attachmentSlot.placementIds, shieldPlacementId],
          optionPlacementIds: [...attachmentSlot.optionPlacementIds, shieldPlacementId],
        },
      },
    };
    const tailored = { ...fixture, catalog };
    let snapshot = materialize(tailored);
    let model = project(snapshot, tailored);
    const attachments = group(model, "Attachments");

    snapshot = applyShipEditorCommand(
      snapshot,
      catalog,
      {
        type: "replace-exclusive",
        instanceId: fixture.unit.id,
        groupId: attachments.id,
        optionId: option(model, "Attachments", "Repair Crane").id,
      },
      fixture.createId,
    );
    model = project(snapshot, tailored);
    expect(option(model, "Attachments", "Shield Generator")).toMatchObject({
      availability: "available",
      reason: null,
      trait: {
        label: "Shield Generator",
        description: "Shield Generator protects its unit.",
      },
    });

    snapshot = applyShipEditorCommand(
      snapshot,
      catalog,
      {
        type: "replace-exclusive",
        instanceId: fixture.unit.id,
        groupId: attachments.id,
        optionId: option(model, "Attachments", "Shield Generator").id,
      },
      fixture.createId,
    );
    model = project(snapshot, tailored);
    expect(option(model, "Attachments", "Repair Crane").selectedQuantity).toBe(0);
    expect(option(model, "Attachments", "Shield Generator").selectedQuantity).toBe(1);
  });

  it("shows the structural Model cost for a Unit attachment", () => {
    const fixture = setup();
    const snapshot = materialize(fixture);
    const initial = project(snapshot, fixture);
    const repairCrane = option(initial, "Attachments", "Repair Crane");
    const repairDefinition = entityByLabel(fixture.catalog, "Repair Crane");
    const unitTemplate = entityByLabel(fixture.catalog, "Akita Demonstrator");
    const modelTemplate = entityByLabel(fixture.catalog, "Akita");
    const modelPlacementTemplate = Object.values(fixture.catalog.placements).find(
      (candidate) =>
        candidate.ownerId === unitTemplate.id && candidate.definitionId === modelTemplate.id,
    )!;
    const attachmentUnitId = entityId(sourceNodeId("test", "selectionEntry", "attachment-unit"));
    const attachmentModelId = entityId(sourceNodeId("test", "selectionEntry", "attachment-model"));
    const attachmentModelPlacementId = placementId(
      attachmentUnitId,
      sourceNodeId("test", "selectionEntry", "attachment-model-link"),
      0,
      "ownership",
    );
    const sourcePlacement = fixture.catalog.placements[repairCrane.id]!;
    const catalog: DomainCatalog = {
      ...fixture.catalog,
      entities: {
        ...fixture.catalog.entities,
        [attachmentUnitId]: {
          ...unitTemplate,
          id: attachmentUnitId,
          label: toSafePresentation("Supply Ship Attachment"),
          costIds: [],
          slotIds: [],
        },
        [attachmentModelId]: {
          ...modelTemplate,
          id: attachmentModelId,
          label: toSafePresentation("Supply Ship Model"),
          costIds: repairDefinition.costIds,
          slotIds: [],
        },
      },
      placements: {
        ...fixture.catalog.placements,
        [repairCrane.id]: { ...sourcePlacement, definitionId: attachmentUnitId },
        [attachmentModelPlacementId]: {
          ...modelPlacementTemplate,
          id: attachmentModelPlacementId,
          ownerId: attachmentUnitId,
          definitionId: attachmentModelId,
        },
      },
    };
    const model = project(snapshot, { ...fixture, catalog });

    expect(option(model, "Attachments", "Supply Ship Attachment").costLabel).toBe("+5 Points");
  });

  it("projects a complete 4/4 base loadout and keeps every choice replaceable", () => {
    const fixture = setup();
    let snapshot = materialize(fixture);
    expect(project(snapshot, fixture).mandatory).toEqual({ selected: 4, required: 4 });
    expect(
      project(snapshot, fixture).problems.filter((problem) => problem.id.startsWith("mandatory:")),
    ).toEqual([]);
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
    expect(preview.profileRules.variant).toBe("effective");
    expect(preview.profileRules.sections.map((section) => section.label)).toEqual([
      "Model",
      "Properties",
      "Systems",
    ]);
    expect(preview.profileRules.weapons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: entityByLabel(fixture.catalog, "Fore Battery").id }),
      ]),
    );
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
          hardpointWeight: "heavy",
        }),
        expect.objectContaining({
          weapon: "Torpedo Battery",
          provenance: "FPS 1",
          hardpointWeight: "heavy",
        }),
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
    const repeatedRows = configured.profileRules.weapons.filter(
      (weapon) => weapon.weapon === "Heavy Battery",
    );
    expect(repeatedRows.map((weapon) => weapon.provenance)).toEqual(["PSA", "FPS 1"]);
    expect(new Set(repeatedRows.map((weapon) => weapon.id)).size).toBe(2);
    expect(
      ready(
        projectShipEditor(
          snapshot,
          catalog,
          fixture.unit.id,
          fixture.unit.definitionId,
          "saved-local",
        ),
      ).profileRules.weapons.filter((weapon) => weapon.weapon === "Heavy Battery"),
    ).toEqual(repeatedRows);
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
