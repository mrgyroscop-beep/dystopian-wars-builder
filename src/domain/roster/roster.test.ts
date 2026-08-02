import { describe, expect, it } from "vitest";
import type {
  CostAmount,
  DomainCatalog,
  DomainEntity,
  EntityId,
  EntityKind,
  EvaluatorExpression,
  Placement,
  PlacementId,
  Slot,
  SlotId,
  SourceNodeId,
} from "../catalog";
import { DOMAIN_SCHEMA_VERSION } from "../catalog";
import { evaluateRoster, rosterInstanceId, type RosterSnapshot } from ".";

describe("roster evaluator", () => {
  it("calculates exact Points and VP with conditional cost modifiers and placement deltas", () => {
    const pointsType = id("points-type");
    const vpType = id("vp-type");
    const shipId = id("akita");
    const optionId = id("upgrade");
    const conditionId = id("has-ship");
    const upperConditionId = id("at-most-two-ships");
    const conditionGroupId = id("ship-count-group");
    const repeatId = id("per-ship-repeat");
    const modifierId = id("points-modifier");
    const pointsCost = cost("akita-points", "350", "points", pointsType, "base", {
      modifierIds: [],
    });
    const vpCost = cost("akita-vp", "9", "vp", vpType, "base");
    const deltaCost = cost("upgrade-points", "25", "points", pointsType, "delta");
    const condition = expressionEntity("Condition", conditionId, {
      operator: "atLeast",
      field: "limit::selection",
      scope: "roster",
      value: "1",
      references: [shipId],
    });
    const upperCondition = expressionEntity("Condition", upperConditionId, {
      operator: "atMost",
      field: "limit::selection",
      scope: "roster",
      value: "2",
      references: [shipId],
    });
    const conditionGroup = expressionEntity("ConditionGroup", conditionGroupId, {
      operator: "and",
      conditionIds: [conditionId, upperConditionId],
    });
    const repeat = expressionEntity("Repeat", repeatId, {
      field: "limit::selection",
      scope: "roster",
      references: [shipId],
    });
    const modifier = expressionEntity("Modifier", modifierId, {
      operator: "add",
      field: pointsType,
      scope: "self",
      value: "10",
      conditionIds: [conditionGroupId],
      repeatIds: [repeatId],
    });
    const ship = baseEntity("Model", shipId, {
      costIds: [pointsCost.id, vpCost.id],
      modifierIds: [modifierId],
    });
    const option = baseEntity("Option", optionId, { costIds: [deltaCost.id] });
    const optionPlacement = placement("upgrade-placement", shipId, optionId, {
      costIds: [deltaCost.id],
    });
    const catalog = makeCatalog(
      [
        baseEntity("CostType", pointsType),
        baseEntity("CostType", vpType),
        ship,
        option,
        pointsCost,
        vpCost,
        deltaCost,
        condition,
        upperCondition,
        conditionGroup,
        repeat,
        modifier,
      ],
      [optionPlacement],
    );
    const root = rosterInstanceId("root");
    const upgrade = rosterInstanceId("upgrade");
    const result = evaluateRoster(
      catalog,
      roster(catalog, [
        instance(root, shipId, { quantity: 2, forceInstanceId: root }),
        instance(upgrade, optionId, {
          parentInstanceId: root,
          forceInstanceId: root,
          placementId: optionPlacement.id,
        }),
      ]),
    );

    expect(result.status).toBe("valid");
    expect(result.totals).toEqual([
      expect.objectContaining({
        key: pointsType,
        resource: "points",
        value: "765",
        complete: true,
      }),
      expect.objectContaining({
        key: vpType,
        resource: "victory-points",
        value: "18",
        complete: true,
      }),
    ]);
    expect(result.contributions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ costId: pointsCost.id, unitValue: "370", value: "740" }),
        expect.objectContaining({ costId: deltaCost.id, origin: "definition", value: "25" }),
      ]),
    );
    expect(result.contributions.filter((entry) => entry.costId === deltaCost.id)).toHaveLength(1);
  });

  it("evaluates slot cardinality and contextual max availability", () => {
    const shipId = id("ship");
    const slotOwnerId = id("hardpoint");
    const slotIdValue = sid("hardpoint-slot");
    const firstOptionId = id("first-option");
    const secondOptionId = id("second-option");
    const thirdOptionId = id("third-option");
    const min = expressionEntity("Constraint", id("slot-min"), {
      operator: "min",
      field: "selections",
      scope: "parent",
      value: "1",
    });
    const max = expressionEntity("Constraint", id("slot-max"), {
      operator: "max",
      field: "selections",
      scope: "parent",
      value: "2",
    });
    const slotOwner = baseEntity("Hardpoint", slotOwnerId, {
      slotIds: [slotIdValue],
      constraintIds: [min.id, max.id],
    });
    const slotPlacement = placement("slot-placement", shipId, slotOwnerId);
    const choices = [firstOptionId, secondOptionId, thirdOptionId];
    const choicePlacements = choices.map((choice, index) =>
      placement(`choice-${index}`, slotOwnerId, choice, {}, slotIdValue, index),
    );
    const slot: Slot = {
      contractVersion: 1,
      id: slotIdValue,
      ownerId: slotOwnerId,
      kind: "Hardpoint",
      label: presentation("Hardpoint"),
      placementIds: choicePlacements.map((choice) => choice.id),
      optionPlacementIds: choicePlacements.map((choice) => choice.id),
      cardinality: {
        contractVersion: 1,
        minimum: amount("1"),
        maximum: amount("2"),
        effective: "deferred-to-kan-32",
      },
      costIds: [],
      constraintIds: [min.id, max.id],
      conditionIds: [],
      modifierIds: [],
      hidden: false,
      helper: false,
      semantics: { contractVersion: 1, selection: "option", evaluation: "deferred-to-kan-32" },
      provenance: provenance(slotOwnerId),
    };
    const catalog = makeCatalog(
      [
        baseEntity("Model", shipId),
        slotOwner,
        ...choices.map((choice) => baseEntity("Option", choice)),
        min,
        max,
      ],
      [slotPlacement, ...choicePlacements],
      [slot],
    );
    const root = rosterInstanceId("root");
    const first = rosterInstanceId("first");
    const second = rosterInstanceId("second");
    const result = evaluateRoster(
      catalog,
      roster(catalog, [
        instance(root, shipId, { forceInstanceId: root }),
        instance(first, firstOptionId, {
          parentInstanceId: root,
          forceInstanceId: root,
          placementId: choicePlacements[0]!.id,
          slotId: slotIdValue,
        }),
        instance(second, secondOptionId, {
          parentInstanceId: root,
          forceInstanceId: root,
          placementId: choicePlacements[1]!.id,
          slotId: slotIdValue,
        }),
      ]),
    );

    expect(result.status).toBe("valid");
    expect(result.slots).toEqual([
      expect.objectContaining({
        ownerInstanceId: root,
        selected: 2,
        minimum: "1",
        maximum: "2",
        status: "satisfied",
      }),
    ]);
    expect(result.availability).toContainEqual({
      ownerInstanceId: root,
      placementId: choicePlacements[2]!.id,
      state: "unavailable",
      reasonCodes: ["SLOT_MAX_REACHED"],
    });
  });

  it("reports mandatory category constraints with an exact instance target", () => {
    const battlefleetId = id("battlefleet");
    const categoryId = id("required-category");
    const unitId = id("unit");
    const constraint = expressionEntity("Constraint", id("required-elements"), {
      operator: "min",
      field: "limit::category",
      scope: "root-entry",
      value: "2",
      references: [categoryId],
    });
    const catalog = makeCatalog([
      baseEntity("Battlefleet", battlefleetId, { constraintIds: [constraint.id] }),
      baseEntity("Category", categoryId),
      baseEntity("Unit", unitId, { categoryIds: [categoryId] }),
      constraint,
    ]);
    const root = rosterInstanceId("fleet");
    const child = rosterInstanceId("unit");
    const result = evaluateRoster(
      catalog,
      roster(catalog, [
        instance(root, battlefleetId, { forceInstanceId: root }),
        instance(child, unitId, { parentInstanceId: root, forceInstanceId: root }),
      ]),
    );

    expect(result.status).toBe("invalid");
    const problem = result.problems.find(
      (candidate) => candidate.code === "CONSTRAINT_MIN_NOT_MET",
    );
    expect(problem).toMatchObject({
      code: "CONSTRAINT_MIN_NOT_MET",
      severity: "error",
      actual: "1",
      expected: "min 2",
    });
    expect(problem?.target).toMatchObject({ instanceId: root, entityId: battlefleetId });
  });

  it("applies self, parent and force scopes plus constraint modifiers", () => {
    const forceId = id("force");
    const unitId = id("scoped-unit");
    const decrementId = id("decrement-minimum");
    const forceMinimumId = id("force-minimum");
    const parentMaximumId = id("parent-maximum");
    const selfMinimumId = id("self-minimum");
    const decrement = expressionEntity("Modifier", decrementId, {
      operator: "decrement",
      field: "selections",
      scope: "self",
      value: "1",
    });
    const forceMinimum = expressionEntity("Constraint", forceMinimumId, {
      operator: "min",
      field: "limit::selection",
      scope: "force",
      value: "3",
      references: [unitId],
      modifierIds: [decrementId],
    });
    const parentMaximum = expressionEntity("Constraint", parentMaximumId, {
      operator: "max",
      field: "limit::selection",
      scope: "parent",
      value: "1",
      references: [unitId],
    });
    const selfMinimum = expressionEntity("Constraint", selfMinimumId, {
      operator: "min",
      field: "limit::selection",
      scope: "self",
      value: "1",
      references: [unitId],
    });
    const catalog = makeCatalog([
      baseEntity("Battlefleet", forceId, { constraintIds: [forceMinimumId] }),
      baseEntity("Unit", unitId, { constraintIds: [parentMaximumId, selfMinimumId] }),
      decrement,
      forceMinimum,
      parentMaximum,
      selfMinimum,
    ]);
    const root = rosterInstanceId("force");
    const first = rosterInstanceId("first-unit");
    const second = rosterInstanceId("second-unit");
    const result = evaluateRoster(
      catalog,
      roster(catalog, [
        instance(root, forceId, { forceInstanceId: root }),
        instance(first, unitId, { parentInstanceId: root, forceInstanceId: root }),
        instance(second, unitId, { parentInstanceId: root, forceInstanceId: root }),
      ]),
    );

    expect(result.status).toBe("invalid");
    expect(result.problems.filter((problem) => problem.code === "CONSTRAINT_MIN_NOT_MET")).toEqual(
      [],
    );
    expect(
      result.problems.filter((problem) => problem.code === "CONSTRAINT_MAX_EXCEEDED"),
    ).toHaveLength(2);
  });

  it("marks a selected conditionally unavailable option invalid", () => {
    const shipId = id("ship");
    const slotOwnerId = id("generator-slot");
    const slotIdValue = sid("generator-slot");
    const optionId = id("generator");
    const requirementId = id("required-model");
    const conditionId = id("requires-model");
    const condition = expressionEntity("Condition", conditionId, {
      operator: "atLeast",
      field: "limit::selection",
      scope: "roster",
      value: "1",
      references: [requirementId],
    });
    const slotOwner = baseEntity("Generator", slotOwnerId, { slotIds: [slotIdValue] });
    const slotPlacement = placement("slot-placement", shipId, slotOwnerId);
    const choicePlacement = placement("choice-placement", slotOwnerId, optionId, {}, slotIdValue);
    const slot: Slot = {
      contractVersion: 1,
      id: slotIdValue,
      ownerId: slotOwnerId,
      kind: "Generator",
      label: presentation("Generator"),
      placementIds: [choicePlacement.id],
      optionPlacementIds: [choicePlacement.id],
      cardinality: {
        contractVersion: 1,
        minimum: amount("0"),
        maximum: amount("1"),
        effective: "deferred-to-kan-32",
      },
      costIds: [],
      constraintIds: [],
      conditionIds: [],
      modifierIds: [],
      hidden: false,
      helper: false,
      semantics: { contractVersion: 1, selection: "option", evaluation: "deferred-to-kan-32" },
      provenance: provenance(slotOwnerId),
    };
    const catalog = makeCatalog(
      [
        baseEntity("Model", shipId),
        slotOwner,
        baseEntity("Option", optionId, { conditionIds: [conditionId] }),
        baseEntity("Model", requirementId),
        condition,
      ],
      [slotPlacement, choicePlacement],
      [slot],
    );
    const root = rosterInstanceId("root");
    const selected = rosterInstanceId("selected");
    const result = evaluateRoster(
      catalog,
      roster(catalog, [
        instance(root, shipId, { forceInstanceId: root }),
        instance(selected, optionId, {
          parentInstanceId: root,
          forceInstanceId: root,
          placementId: choicePlacement.id,
          slotId: slotIdValue,
        }),
      ]),
    );

    expect(result.status).toBe("invalid");
    expect(result.availability[0]).toMatchObject({
      placementId: choicePlacement.id,
      state: "unavailable",
      reasonCodes: ["CONDITION_NOT_MET"],
    });
    const problem = result.problems.find(
      (candidate) => candidate.code === "SELECTED_UNAVAILABLE_OPTION",
    );
    expect(problem).toBeDefined();
    expect(problem?.target).toMatchObject({
      instanceId: selected,
      placementId: choicePlacement.id,
      slotId: slotIdValue,
    });
  });

  it("fails closed and stays deterministic for an unevaluable expression", () => {
    const unitId = id("unit");
    const constraintId = id("unsupported");
    const constraint = expressionEntity("Constraint", constraintId, {
      operator: "mystery",
      field: "selections",
      scope: "roster",
      value: "1",
      evaluable: false,
      unevaluableReasons: ["UNKNOWN_OPERATOR"],
    });
    const catalog = makeCatalog([
      baseEntity("Unit", unitId, { constraintIds: [constraintId] }),
      constraint,
    ]);
    const root = rosterInstanceId("root");
    const snapshot = roster(catalog, [instance(root, unitId, { forceInstanceId: root })]);
    const first = evaluateRoster(catalog, snapshot);
    const second = evaluateRoster(catalog, structuredClone(snapshot));

    expect(first).toEqual(second);
    expect(first.status).toBe("indeterminate");
    expect(first.valid).toBe(false);
    expect(first.problems).toContainEqual(
      expect.objectContaining({ code: "UNEVALUABLE_CONSTRAINT", severity: "indeterminate" }),
    );
  });

  it("does not coerce unknown cost values to zero", () => {
    const unitId = id("unit");
    const unknownCost = cost("unknown", "?", "points", id("points-type"), "base");
    const catalog = makeCatalog([
      baseEntity("Unit", unitId, { costIds: [unknownCost.id] }),
      unknownCost,
    ]);
    const root = rosterInstanceId("root");
    const result = evaluateRoster(
      catalog,
      roster(catalog, [instance(root, unitId, { forceInstanceId: root })]),
    );

    expect(result.status).toBe("indeterminate");
    expect(result.totals[0]).toMatchObject({ value: "0", complete: false });
    expect(result.contributions).toEqual([]);
    expect(result.problems).toContainEqual(
      expect.objectContaining({ code: "UNKNOWN_COST_AMOUNT" }),
    );
  });
});

function makeCatalog(
  entities: readonly DomainEntity[],
  placements: readonly Placement[] = [],
  slots: readonly Slot[] = [],
): DomainCatalog {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    contentVersion: "catalog-v1",
    source: source,
    entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])),
    placements: Object.fromEntries(placements.map((placement) => [placement.id, placement])),
    slots: Object.fromEntries(slots.map((slot) => [slot.id, slot])),
    aliases: {},
    roots: [],
    diagnostics: [],
  };
}

function roster(
  catalog: DomainCatalog,
  instances: readonly ReturnType<typeof instance>[],
): RosterSnapshot {
  return {
    contractVersion: 1,
    id: "test-roster",
    catalogContentVersion: catalog.contentVersion,
    rootInstanceIds: instances
      .filter((candidate) => candidate.parentInstanceId === null)
      .map((candidate) => candidate.id),
    instances: Object.fromEntries(instances.map((candidate) => [candidate.id, candidate])),
  };
}

function instance(
  instanceId: ReturnType<typeof rosterInstanceId>,
  definitionId: EntityId,
  overrides: Partial<{
    placementId: PlacementId | null;
    slotId: SlotId | null;
    parentInstanceId: ReturnType<typeof rosterInstanceId> | null;
    forceInstanceId: ReturnType<typeof rosterInstanceId> | null;
    quantity: number;
  }> = {},
) {
  return {
    contractVersion: 1 as const,
    id: instanceId,
    definitionId,
    placementId: overrides.placementId ?? null,
    slotId: overrides.slotId ?? null,
    parentInstanceId: overrides.parentInstanceId ?? null,
    forceInstanceId: overrides.forceInstanceId ?? null,
    quantity: overrides.quantity ?? 1,
  };
}

function baseEntity(
  kind: EntityKind,
  entityId: EntityId,
  overrides: Partial<DomainEntity> = {},
): DomainEntity {
  return {
    contractVersion: 1,
    id: entityId,
    kind,
    sourceTag: kind,
    identityQuality: "upstream",
    identity: {
      contractVersion: 1,
      canonicalId: entityId,
      sourceNodeId: sourceId(entityId),
      upstreamId: entityId,
      occurrence: 1,
      quality: "upstream",
      migrationAliasIds: [],
    },
    label: presentation(entityId),
    labels: {
      contractVersion: 1,
      canonicalLabel: entityId,
      sourceLabel: entityId,
      aliases: [],
      locale: "und",
      fallbackLabel: entityId,
    },
    attributes: {},
    fields: [],
    extensions: [],
    categoryIds: [],
    costIds: [],
    constraintIds: [],
    conditionIds: [],
    modifierIds: [],
    repeatIds: [],
    profileIds: [],
    ruleIds: [],
    slotIds: [],
    provenance: provenance(entityId),
    ...overrides,
  } as DomainEntity;
}

function cost(
  valueId: string,
  raw: string,
  resource: "points" | "vp",
  costTypeId: EntityId,
  role: "base" | "delta",
  overrides: Partial<DomainEntity> = {},
): Extract<DomainEntity, { kind: "Cost" }> {
  const value = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(raw)
    ? amount(raw)
    : ({ contractVersion: 1, state: "unknown", raw } as const);
  return baseEntity("Cost", id(valueId), {
    amount: value,
    semantics: {
      contractVersion: 1,
      amount: value,
      costTypeId,
      sourceCostTypeId: resource === "points" ? "points" : "vp",
      resource: resource === "points" ? "points" : "victory-points",
      role,
      scope: null,
    },
    ...overrides,
  }) as Extract<DomainEntity, { kind: "Cost" }>;
}

function expressionEntity(
  kind: "Constraint" | "Condition" | "ConditionGroup" | "Modifier" | "Repeat",
  entityId: EntityId,
  options: Partial<EvaluatorExpression> & {
    readonly conditionIds?: readonly EntityId[];
    readonly modifierIds?: readonly EntityId[];
    readonly repeatIds?: readonly EntityId[];
  },
): Extract<DomainEntity, { expression: EvaluatorExpression }> {
  const { conditionIds = [], modifierIds = [], repeatIds = [], ...expressionOverrides } = options;
  return baseEntity(kind, entityId, {
    conditionIds,
    modifierIds,
    repeatIds,
    expression: {
      contractVersion: 1,
      operator: null,
      field: null,
      scope: null,
      value: null,
      references: [],
      referenceResolutions: [],
      flags: {},
      evaluable: true,
      unevaluableReasons: [],
      ...expressionOverrides,
    },
  }) as Extract<DomainEntity, { expression: EvaluatorExpression }>;
}

function placement(
  valueId: string,
  ownerId: EntityId,
  definitionId: EntityId,
  overlay: Partial<Placement["overlay"]> = {},
  slotIdValue: SlotId | null = null,
  order = 0,
): Placement {
  const placementIdValue = pid(valueId);
  return {
    contractVersion: 1,
    id: placementIdValue,
    ownerId,
    definitionId,
    slotId: slotIdValue,
    order,
    linkKind: "ownership",
    resolved: true,
    ambiguous: false,
    targetSourceNodeId: sourceId(definitionId),
    resolution: null,
    overlay: {
      categoryIds: [],
      costIds: [],
      constraintIds: [],
      conditionIds: [],
      modifierIds: [],
      repeatIds: [],
      attributes: {},
      ...overlay,
    },
    provenance: provenance(ownerId),
  };
}

function amount(raw: string): CostAmount {
  if (raw === "0") return { contractVersion: 1, state: "zero", value: "0" };
  return { contractVersion: 1, state: "value", value: raw };
}

function presentation(value: string) {
  return { plainText: value, blocks: [], contentUnavailable: false, diagnostics: [] } as const;
}

const source = {
  repository: "test/repository",
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  commitTimestamp: "2026-08-02T00:00:00Z",
} as const;

function provenance(entityId: EntityId) {
  return {
    source,
    documentPath: "Synthetic.cat",
    documentBlob: "c".repeat(40),
    documentSha256: "d".repeat(64),
    documentRootId: "synthetic",
    sourceNodeId: sourceId(entityId),
    sourceTag: "synthetic",
    upstreamId: entityId,
    occurrence: 1,
    xmlPath: "/synthetic",
    resolutionChain: [],
    sourceRevision: "1",
    importRevision: 1,
    schemaRevision: DOMAIN_SCHEMA_VERSION,
  } as const;
}

function id(value: string): EntityId {
  return `dw4:test:${value}` as EntityId;
}

function pid(value: string): PlacementId {
  return `placement:test:${value}` as PlacementId;
}

function sid(value: string): SlotId {
  return `slot:test:${value}` as SlotId;
}

function sourceId(value: string): SourceNodeId {
  return `source:test:${value}` as SourceNodeId;
}
