import type {
  Cost,
  CostAmount,
  DomainCatalog,
  DomainEntity,
  EntityId,
  EvaluatorExpression,
  Placement,
  Slot,
  SlotId,
} from "../catalog";
import {
  addDecimal,
  compareDecimal,
  decimalToString,
  multiplyDecimal,
  multiplyDecimalByInteger,
  parseDecimal,
  zeroDecimal,
  type DecimalValue,
} from "./decimal";
import type {
  CostContribution,
  CostTotal,
  EffectiveSlotCardinality,
  PlacementAvailability,
  ProblemSeverity,
  ProblemTarget,
  RosterEvaluation,
  RosterInstanceId,
  RosterProblem,
  RosterSelectionInstance,
  RosterSnapshot,
} from "./types";

type Truth =
  { readonly state: "true" | "false" } | { readonly state: "unknown"; readonly code: string };
type Numeric =
  | { readonly state: "known"; readonly value: DecimalValue }
  | { readonly state: "unknown"; readonly code: string };

interface MutableTotal {
  readonly key: string;
  readonly resource: CostTotal["resource"];
  readonly costTypeId: EntityId | null;
  readonly sourceCostTypeId: string | null;
  value: DecimalValue;
  complete: boolean;
}

const EMPTY_TARGET: ProblemTarget = {
  instanceId: null,
  entityId: null,
  placementId: null,
  slotId: null,
};

export function rosterInstanceId(value: string): RosterInstanceId {
  return value as RosterInstanceId;
}

export function evaluateRoster(catalog: DomainCatalog, roster: RosterSnapshot): RosterEvaluation {
  const instances = Object.values(roster.instances).sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const problems = new Map<string, RosterProblem>();
  const contributions: CostContribution[] = [];
  const totals = new Map<string, MutableTotal>();
  const slotResults: EffectiveSlotCardinality[] = [];
  const availability: PlacementAvailability[] = [];
  const children = new Map<string, RosterSelectionInstance[]>();
  const placementsByOwner = new Map<string, Placement[]>();
  const upstreamEntities = new Map<string, EntityId[]>();

  for (const placement of Object.values(catalog.placements)) {
    const owned = placementsByOwner.get(placement.ownerId) ?? [];
    owned.push(placement);
    placementsByOwner.set(placement.ownerId, owned);
  }
  for (const owned of placementsByOwner.values()) owned.sort(comparePlacement);
  for (const entity of Object.values(catalog.entities)) {
    const upstreamId = entity.identity.upstreamId;
    if (!upstreamId) continue;
    const ids = upstreamEntities.get(upstreamId) ?? [];
    ids.push(entity.id);
    upstreamEntities.set(upstreamId, ids);
  }
  for (const ids of upstreamEntities.values()) ids.sort();
  for (const instance of instances) {
    if (!instance.parentInstanceId) continue;
    const siblings = children.get(instance.parentInstanceId) ?? [];
    siblings.push(instance);
    children.set(instance.parentInstanceId, siblings);
  }
  for (const siblings of children.values()) siblings.sort(compareInstance);

  validateSnapshot();
  for (const instance of instances) {
    if (!catalog.entities[instance.definitionId]) continue;
    evaluateCosts(instance);
    evaluateEntityConstraints(instance);
    evaluateSlots(instance);
  }

  const sortedProblems = [...problems.values()].sort(compareProblem);
  const status = sortedProblems.some((problem) => problem.severity === "indeterminate")
    ? "indeterminate"
    : sortedProblems.some((problem) => problem.severity === "error")
      ? "invalid"
      : "valid";
  return {
    contractVersion: 1,
    rosterId: roster.id,
    catalogContentVersion: catalog.contentVersion,
    status,
    valid: status === "valid",
    totals: [...totals.values()]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((total) => ({ ...total, value: decimalToString(total.value) })),
    contributions: contributions.sort((left, right) =>
      `${left.instanceId}:${left.origin}:${left.costId}`.localeCompare(
        `${right.instanceId}:${right.origin}:${right.costId}`,
      ),
    ),
    slots: slotResults.sort((left, right) =>
      `${left.ownerInstanceId}:${left.slotId}`.localeCompare(
        `${right.ownerInstanceId}:${right.slotId}`,
      ),
    ),
    availability: availability.sort((left, right) =>
      `${left.ownerInstanceId}:${left.placementId}`.localeCompare(
        `${right.ownerInstanceId}:${right.placementId}`,
      ),
    ),
    problems: sortedProblems,
  };

  function validateSnapshot(): void {
    if (roster.catalogContentVersion !== catalog.contentVersion)
      addProblem(
        "CATALOG_VERSION_MISMATCH",
        "indeterminate",
        "Roster and catalogue content versions do not match.",
        EMPTY_TARGET,
        null,
        roster.catalogContentVersion,
        catalog.contentVersion,
      );
    const declaredRoots = new Set(roster.rootInstanceIds);
    for (const [key, instance] of Object.entries(roster.instances)) {
      const target = targetFor(instance);
      if (key !== instance.id)
        addProblem(
          "INSTANCE_KEY_MISMATCH",
          "indeterminate",
          "Roster instance key does not match its stable ID.",
          target,
          instance.definitionId,
          key,
          instance.id,
        );
      if (!Number.isSafeInteger(instance.quantity) || instance.quantity < 1)
        addProblem(
          "INVALID_QUANTITY",
          "indeterminate",
          "Selection quantity must be a positive safe integer.",
          target,
          instance.definitionId,
          String(instance.quantity),
          "positive integer",
        );
      if (!catalog.entities[instance.definitionId])
        addProblem(
          "UNKNOWN_DEFINITION",
          "indeterminate",
          "Roster selection refers to an unknown catalogue definition.",
          target,
          instance.definitionId,
          instance.definitionId,
          "known EntityId",
        );
      if (instance.parentInstanceId && !roster.instances[instance.parentInstanceId])
        addProblem(
          "UNKNOWN_PARENT",
          "indeterminate",
          "Roster selection refers to an unknown parent instance.",
          target,
          instance.definitionId,
          instance.parentInstanceId,
          "known RosterInstanceId",
        );
      if (instance.forceInstanceId && !roster.instances[instance.forceInstanceId])
        addProblem(
          "UNKNOWN_FORCE",
          "indeterminate",
          "Roster selection refers to an unknown force instance.",
          target,
          instance.definitionId,
          instance.forceInstanceId,
          "known RosterInstanceId",
        );
      if ((instance.parentInstanceId === null) !== declaredRoots.has(instance.id))
        addProblem(
          "ROOT_MEMBERSHIP_MISMATCH",
          "indeterminate",
          "Root membership and parent linkage disagree.",
          target,
          instance.definitionId,
          instance.parentInstanceId === null ? "root" : "child",
          declaredRoots.has(instance.id) ? "root" : "child",
        );
      validatePlacement(instance);
      validateParentCycle(instance);
    }
    for (const rootId of declaredRoots)
      if (!roster.instances[rootId])
        addProblem(
          "UNKNOWN_ROOT",
          "indeterminate",
          "Roster root refers to an unknown instance.",
          { ...EMPTY_TARGET, instanceId: rootId },
          null,
          rootId,
          "known RosterInstanceId",
        );
  }

  function validatePlacement(instance: RosterSelectionInstance): void {
    if (!instance.placementId) return;
    const placement = catalog.placements[instance.placementId];
    if (!placement) {
      addProblem(
        "UNKNOWN_PLACEMENT",
        "indeterminate",
        "Roster selection refers to an unknown placement.",
        targetFor(instance),
        instance.definitionId,
        instance.placementId,
        "known PlacementId",
      );
      return;
    }
    if (placement.definitionId !== instance.definitionId)
      addProblem(
        "PLACEMENT_DEFINITION_MISMATCH",
        "indeterminate",
        "Placement target does not match the selected definition.",
        targetFor(instance),
        instance.definitionId,
        placement.definitionId,
        instance.definitionId,
      );
    const parent = instance.parentInstanceId
      ? roster.instances[instance.parentInstanceId]
      : undefined;
    const contextualSlot = instance.slotId ? catalog.slots[instance.slotId] : undefined;
    const slotBelongsToParent =
      parent &&
      contextualSlot &&
      contextualSlot.ownerId === placement.ownerId &&
      slotsFor(parent).some((slot) => slot.id === contextualSlot.id);
    if (parent && placement.ownerId !== parent.definitionId && !slotBelongsToParent)
      addProblem(
        "PLACEMENT_OWNER_MISMATCH",
        "indeterminate",
        "Placement owner does not match the parent selection.",
        targetFor(instance),
        instance.definitionId,
        placement.ownerId,
        parent.definitionId,
      );
    if (instance.slotId && placement.slotId && placement.slotId !== instance.slotId)
      addProblem(
        "PLACEMENT_SLOT_MISMATCH",
        "indeterminate",
        "Placement slot does not match the selected slot.",
        targetFor(instance),
        instance.definitionId,
        placement.slotId,
        instance.slotId,
      );
  }

  function validateParentCycle(instance: RosterSelectionInstance): void {
    const visited = new Set<string>([instance.id]);
    let current = instance.parentInstanceId;
    while (current) {
      if (visited.has(current)) {
        addProblem(
          "INSTANCE_PARENT_CYCLE",
          "indeterminate",
          "Roster instance parent links contain a cycle.",
          targetFor(instance),
          instance.definitionId,
          current,
          null,
        );
        return;
      }
      visited.add(current);
      current = roster.instances[current]?.parentInstanceId ?? null;
    }
  }

  function evaluateCosts(instance: RosterSelectionInstance): void {
    const entity = catalog.entities[instance.definitionId];
    if (!entity) return;
    const incoming = instance.placementId ? catalog.placements[instance.placementId] : undefined;
    const sources: readonly ["definition" | "placement", readonly EntityId[]][] = [
      ["definition", entity.costIds],
      ["placement", incoming?.overlay.costIds ?? []],
    ];
    const seen = new Set<EntityId>();
    for (const [origin, ids] of sources) {
      for (const costId of [...new Set(ids)].sort()) {
        if (seen.has(costId)) continue;
        seen.add(costId);
        const candidate = catalog.entities[costId];
        if (!candidate || candidate.kind !== "Cost") {
          addProblem(
            "INVALID_COST_REFERENCE",
            "indeterminate",
            "Cost reference does not resolve to a Cost entity.",
            targetFor(instance),
            costId,
            candidate?.kind ?? "missing",
            "Cost",
          );
          continue;
        }
        addCost(candidate, origin, instance, entity);
      }
    }
  }

  function addCost(
    cost: Cost,
    origin: "definition" | "placement",
    instance: RosterSelectionInstance,
    owner: DomainEntity,
  ): void {
    if (cost.semantics.role === "limit" || cost.amount.state === "not-applicable") return;
    const total = totalFor(cost);
    const enabled = evaluateConditions(cost.conditionIds, instance, new Set());
    if (enabled.state === "false") return;
    if (enabled.state === "unknown") {
      total.complete = false;
      indeterminateExpression(enabled.code, instance, cost.id);
      return;
    }
    const amount = decimalFromAmount(cost.amount);
    if (amount.state === "unknown") {
      total.complete = false;
      addProblem(
        "UNKNOWN_COST_AMOUNT",
        "indeterminate",
        "Cost amount is missing, unknown, or invalid for evaluation.",
        targetFor(instance),
        cost.id,
        amount.code,
        "decimal amount",
      );
      return;
    }
    const modifierIds = [...new Set([...cost.modifierIds, ...owner.modifierIds])].sort();
    const modified = applyModifiers(amount.value, modifierIds, instance, (modifier) =>
      modifierTargetsCost(modifier, cost),
    );
    if (modified.state === "unknown") {
      total.complete = false;
      indeterminateExpression(modified.code, instance, cost.id);
      return;
    }
    const value = multiplyDecimalByInteger(modified.value, instance.quantity);
    total.value = addDecimal(total.value, value);
    contributions.push({
      instanceId: instance.id,
      costId: cost.id,
      origin,
      resource: cost.semantics.resource,
      costTypeId: cost.semantics.costTypeId,
      sourceCostTypeId: cost.semantics.sourceCostTypeId,
      role: cost.semantics.role === "delta" ? "delta" : "base",
      quantity: instance.quantity,
      unitValue: decimalToString(modified.value),
      value: decimalToString(value),
    });
  }

  function totalFor(cost: Cost): MutableTotal {
    const key =
      cost.semantics.costTypeId ??
      cost.semantics.sourceCostTypeId ??
      `${cost.semantics.resource}:unknown`;
    const existing = totals.get(key);
    if (existing) return existing;
    const total: MutableTotal = {
      key,
      resource: cost.semantics.resource,
      costTypeId: cost.semantics.costTypeId,
      sourceCostTypeId: cost.semantics.sourceCostTypeId,
      value: zeroDecimal(),
      complete: true,
    };
    totals.set(key, total);
    return total;
  }

  function evaluateEntityConstraints(instance: RosterSelectionInstance): void {
    const entity = catalog.entities[instance.definitionId];
    if (!entity) return;
    const incoming = instance.placementId ? catalog.placements[instance.placementId] : undefined;
    const ids = [
      ...new Set([...entity.constraintIds, ...(incoming?.overlay.constraintIds ?? [])]),
    ].sort();
    for (const constraintId of ids) evaluateConstraint(constraintId, instance, null, false);
  }

  function evaluateConstraint(
    constraintId: EntityId,
    instance: RosterSelectionInstance,
    slotIdValue: SlotId | null,
    availabilityCheck: boolean,
  ): Truth {
    const constraint = catalog.entities[constraintId];
    if (!constraint || constraint.kind !== "Constraint") {
      indeterminateExpression("INVALID_CONSTRAINT_REFERENCE", instance, constraintId, slotIdValue);
      return { state: "unknown", code: "INVALID_CONSTRAINT_REFERENCE" };
    }
    const expression = constraint.expression;
    if (!expression.evaluable) {
      indeterminateExpression("UNEVALUABLE_CONSTRAINT", instance, constraint.id, slotIdValue);
      return { state: "unknown", code: "UNEVALUABLE_CONSTRAINT" };
    }
    const active = evaluateConditions(constraint.conditionIds, instance, new Set());
    if (active.state !== "true") {
      if (active.state === "unknown")
        indeterminateExpression(active.code, instance, constraint.id, slotIdValue);
      return active;
    }
    if (expression.operator !== "min" && expression.operator !== "max") {
      indeterminateExpression(
        "UNSUPPORTED_CONSTRAINT_OPERATOR",
        instance,
        constraint.id,
        slotIdValue,
      );
      return { state: "unknown", code: "UNSUPPORTED_CONSTRAINT_OPERATOR" };
    }
    const rawBound = expression.value ? parseDecimal(expression.value) : null;
    if (!rawBound) {
      indeterminateExpression("INVALID_CONSTRAINT_VALUE", instance, constraint.id, slotIdValue);
      return { state: "unknown", code: "INVALID_CONSTRAINT_VALUE" };
    }
    const bound = applyModifiers(rawBound, constraint.modifierIds, instance, () => true);
    if (bound.state === "unknown") {
      indeterminateExpression(bound.code, instance, constraint.id, slotIdValue);
      return { state: "unknown", code: bound.code };
    }
    const actual = metricForExpression(expression, instance);
    if (actual.state === "unknown") {
      indeterminateExpression(actual.code, instance, constraint.id, slotIdValue);
      return { state: "unknown", code: actual.code };
    }
    const comparison = compareDecimal(actual.value, bound.value);
    const satisfied = expression.operator === "min" ? comparison >= 0 : comparison <= 0;
    if (!satisfied && !availabilityCheck)
      addProblem(
        expression.operator === "min" ? "CONSTRAINT_MIN_NOT_MET" : "CONSTRAINT_MAX_EXCEEDED",
        "error",
        expression.operator === "min"
          ? "A required minimum selection constraint is not met."
          : "A maximum selection constraint is exceeded.",
        { ...targetFor(instance), slotId: slotIdValue },
        constraint.id,
        decimalToString(actual.value),
        `${expression.operator} ${decimalToString(bound.value)}`,
      );
    return satisfied ? { state: "true" } : { state: "false" };
  }

  function evaluateSlots(instance: RosterSelectionInstance): void {
    for (const slot of slotsFor(instance)) {
      const selectedChildren = (children.get(instance.id) ?? []).filter(
        (child) => child.slotId === slot.id,
      );
      const selected = selectedChildren.reduce((sum, child) => sum + child.quantity, 0);
      const bounds = effectiveSlotBounds(slot, instance);
      if (bounds.state === "unknown") {
        slotResults.push({
          ownerInstanceId: instance.id,
          slotId: slot.id,
          selected,
          minimum: null,
          maximum: null,
          status: "indeterminate",
        });
        indeterminateExpression(bounds.code, instance, slot.ownerId, slot.id);
      } else {
        const actual = parseDecimal(String(selected))!;
        const below = bounds.minimum && compareDecimal(actual, bounds.minimum) < 0;
        const above = bounds.maximum && compareDecimal(actual, bounds.maximum) > 0;
        const slotStatus = below ? "underfilled" : above ? "overfilled" : "satisfied";
        slotResults.push({
          ownerInstanceId: instance.id,
          slotId: slot.id,
          selected,
          minimum: bounds.minimum ? decimalToString(bounds.minimum) : null,
          maximum: bounds.maximum ? decimalToString(bounds.maximum) : null,
          status: slotStatus,
        });
        if (below)
          addProblem(
            "SLOT_MIN_NOT_MET",
            "error",
            "A required option slot is underfilled.",
            { ...targetFor(instance), entityId: slot.ownerId, slotId: slot.id },
            slot.ownerId,
            String(selected),
            `min ${decimalToString(bounds.minimum)}`,
          );
        if (above)
          addProblem(
            "SLOT_MAX_EXCEEDED",
            "error",
            "An option slot contains too many selections.",
            { ...targetFor(instance), entityId: slot.ownerId, slotId: slot.id },
            slot.ownerId,
            String(selected),
            `max ${decimalToString(bounds.maximum)}`,
          );
      }
      evaluateSlotAvailability(slot, instance, selectedChildren, bounds);
    }
  }

  function slotsFor(instance: RosterSelectionInstance): Slot[] {
    const ids = new Set<SlotId>();
    const entity = catalog.entities[instance.definitionId];
    for (const id of entity?.slotIds ?? []) ids.add(id);
    for (const placement of placementsByOwner.get(instance.definitionId) ?? []) {
      if (!placement.definitionId) continue;
      for (const id of catalog.entities[placement.definitionId]?.slotIds ?? []) ids.add(id);
    }
    return [...ids]
      .map((id) => catalog.slots[id])
      .filter((slot): slot is Slot => Boolean(slot))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  function effectiveSlotBounds(
    slot: Slot,
    instance: RosterSelectionInstance,
  ):
    | {
        readonly state: "known";
        readonly minimum: DecimalValue | null;
        readonly maximum: DecimalValue | null;
      }
    | { readonly state: "unknown"; readonly code: string } {
    let minimum: DecimalValue | null = null;
    let maximum: DecimalValue | null = null;
    let foundMinimum = false;
    let foundMaximum = false;
    for (const constraintId of [...slot.constraintIds].sort()) {
      const constraint = catalog.entities[constraintId];
      if (!constraint || constraint.kind !== "Constraint")
        return { state: "unknown", code: "INVALID_SLOT_CONSTRAINT" };
      if (constraint.expression.field !== "selections") continue;
      const active = evaluateConditions(constraint.conditionIds, instance, new Set());
      if (active.state === "unknown") return active;
      if (active.state === "false") continue;
      const raw = constraint.expression.value ? parseDecimal(constraint.expression.value) : null;
      if (!raw || !constraint.expression.evaluable)
        return { state: "unknown", code: "UNEVALUABLE_SLOT_CONSTRAINT" };
      const modified = applyModifiers(raw, constraint.modifierIds, instance, () => true);
      if (modified.state === "unknown") return modified;
      if (constraint.expression.operator === "min") {
        minimum = minimum && compareDecimal(minimum, modified.value) > 0 ? minimum : modified.value;
        foundMinimum = true;
      } else if (constraint.expression.operator === "max") {
        maximum = maximum && compareDecimal(maximum, modified.value) < 0 ? maximum : modified.value;
        foundMaximum = true;
      }
    }
    if (!foundMinimum) minimum = decimalFromCardinality(slot.cardinality.minimum);
    if (!foundMaximum) maximum = decimalFromCardinality(slot.cardinality.maximum);
    return { state: "known", minimum, maximum };
  }

  function evaluateSlotAvailability(
    slot: Slot,
    owner: RosterSelectionInstance,
    selectedChildren: readonly RosterSelectionInstance[],
    bounds:
      | {
          readonly state: "known";
          readonly minimum: DecimalValue | null;
          readonly maximum: DecimalValue | null;
        }
      | { readonly state: "unknown"; readonly code: string },
  ): void {
    const selectedCount = selectedChildren.reduce((sum, child) => sum + child.quantity, 0);
    for (const placementId of [...slot.optionPlacementIds].sort()) {
      const placement = catalog.placements[placementId];
      if (!placement) continue;
      const reasons = new Set<string>();
      let state: PlacementAvailability["state"] = "available";
      const target = placement.definitionId ? catalog.entities[placement.definitionId] : undefined;
      const conditionIds = [
        ...new Set([...placement.overlay.conditionIds, ...(target?.conditionIds ?? [])]),
      ].sort();
      const enabled = evaluateConditions(conditionIds, owner, new Set());
      if (enabled.state === "false") {
        state = "unavailable";
        reasons.add("CONDITION_NOT_MET");
      } else if (enabled.state === "unknown") {
        state = "indeterminate";
        reasons.add(enabled.code);
      }
      const selectedByPlacement = selectedChildren.filter(
        (child) => child.placementId === placementId,
      );
      const alreadySelected = selectedByPlacement.length > 0;
      if (bounds.state === "unknown") {
        state = "indeterminate";
        reasons.add(bounds.code);
      } else if (
        bounds.maximum &&
        compareDecimal(parseDecimal(String(selectedCount))!, bounds.maximum) >= 0 &&
        !alreadySelected
      ) {
        state = "unavailable";
        reasons.add("SLOT_MAX_REACHED");
      }
      for (const constraintId of [...placement.overlay.constraintIds].sort()) {
        const result = evaluateConstraint(constraintId, owner, slot.id, true);
        if (result.state === "false") {
          state = "unavailable";
          reasons.add("PLACEMENT_CONSTRAINT");
        } else if (result.state === "unknown") {
          state = "indeterminate";
          reasons.add(result.code);
        }
      }
      availability.push({
        ownerInstanceId: owner.id,
        placementId,
        state,
        reasonCodes: [...reasons].sort(),
      });
      if (state !== "available")
        for (const selected of selectedByPlacement)
          addProblem(
            "SELECTED_UNAVAILABLE_OPTION",
            state === "indeterminate" ? "indeterminate" : "error",
            "A selected option is unavailable in the current roster context.",
            targetFor(selected),
            placement.definitionId,
            state,
            "available",
          );
    }
  }

  function evaluateConditions(
    conditionIds: readonly EntityId[],
    instance: RosterSelectionInstance,
    stack: Set<string>,
  ): Truth {
    for (const conditionId of [...new Set(conditionIds)].sort()) {
      const result = evaluateCondition(conditionId, instance, stack);
      if (result.state !== "true") return result;
    }
    return { state: "true" };
  }

  function evaluateCondition(
    conditionId: EntityId,
    instance: RosterSelectionInstance,
    stack: Set<string>,
  ): Truth {
    if (stack.has(conditionId)) return { state: "unknown", code: "CONDITION_CYCLE" };
    const entity = catalog.entities[conditionId];
    if (!entity || (entity.kind !== "Condition" && entity.kind !== "ConditionGroup"))
      return { state: "unknown", code: "INVALID_CONDITION_REFERENCE" };
    if (!entity.expression.evaluable) return { state: "unknown", code: "UNEVALUABLE_CONDITION" };
    const nextStack = new Set(stack).add(conditionId);
    if (entity.kind === "ConditionGroup") {
      const childrenIds = [...entity.conditionIds].sort();
      if (childrenIds.length === 0) return { state: "unknown", code: "EMPTY_CONDITION_GROUP" };
      const values = childrenIds.map((id) => evaluateCondition(id, instance, nextStack));
      if (entity.expression.operator === "and") {
        if (values.some((value) => value.state === "false")) return { state: "false" };
        return (
          values.find(
            (value): value is Extract<Truth, { state: "unknown" }> => value.state === "unknown",
          ) ?? { state: "true" }
        );
      }
      if (entity.expression.operator === "or") {
        if (values.some((value) => value.state === "true")) return { state: "true" };
        return (
          values.find(
            (value): value is Extract<Truth, { state: "unknown" }> => value.state === "unknown",
          ) ?? { state: "false" }
        );
      }
      return { state: "unknown", code: "UNSUPPORTED_CONDITION_GROUP" };
    }
    const metric = metricForExpression(entity.expression, instance);
    if (metric.state === "unknown") return metric;
    if (entity.expression.operator === "instanceOf")
      return compareDecimal(metric.value, zeroDecimal()) > 0
        ? { state: "true" }
        : { state: "false" };
    const expected = entity.expression.value ? parseDecimal(entity.expression.value) : null;
    if (!expected) return { state: "unknown", code: "INVALID_CONDITION_VALUE" };
    const compared = compareDecimal(metric.value, expected);
    switch (entity.expression.operator) {
      case "atLeast":
        return compared >= 0 ? { state: "true" } : { state: "false" };
      case "atMost":
        return compared <= 0 ? { state: "true" } : { state: "false" };
      case "equalTo":
        return compared === 0 ? { state: "true" } : { state: "false" };
      case "notEqualTo":
        return compared !== 0 ? { state: "true" } : { state: "false" };
      default:
        return { state: "unknown", code: "UNSUPPORTED_CONDITION_OPERATOR" };
    }
  }

  function metricForExpression(
    expression: EvaluatorExpression,
    instance: RosterSelectionInstance,
  ): Numeric {
    if (!expression.evaluable) return { state: "unknown", code: "UNEVALUABLE_EXPRESSION" };
    const population = scopePopulation(expression.scope, instance);
    if (population.state === "unknown") return population;
    const fieldTarget = resolveEntityToken(expression.field);
    if (fieldTarget.state === "unknown") return fieldTarget;
    const targets =
      expression.references.length > 0
        ? expression.references
        : fieldTarget.entityId
          ? [fieldTarget.entityId]
          : [];
    if (expression.field === "forces") {
      const forceIds = new Set(
        population.instances.flatMap((candidate) => {
          if (targets.length > 0 && !targets.some((target) => instanceMatches(candidate, target)))
            return [];
          const forceId = candidate.forceInstanceId ?? rootAncestor(candidate)?.id;
          return forceId ? [forceId] : [];
        }),
      );
      return { state: "known", value: parseDecimal(String(forceIds.size))! };
    }
    if (expression.field === "cost" || fieldTarget.kind === "CostType")
      return rawCostMetric(population.instances, targets[0] ?? null);
    if (expression.field === "name") return { state: "unknown", code: "UNSUPPORTED_NAME_FIELD" };
    const count = population.instances.reduce((sum, candidate) => {
      if (targets.length === 0) return sum + candidate.quantity;
      return targets.some((target) => instanceMatches(candidate, target))
        ? sum + candidate.quantity
        : sum;
    }, 0);
    return { state: "known", value: parseDecimal(String(count))! };
  }

  function scopePopulation(
    scope: string | null,
    instance: RosterSelectionInstance,
  ):
    | { readonly state: "known"; readonly instances: readonly RosterSelectionInstance[] }
    | { readonly state: "unknown"; readonly code: string } {
    switch (scope ?? "self") {
      case "self":
        return { state: "known", instances: [instance] };
      case "parent": {
        const parentId = instance.parentInstanceId;
        return {
          state: "known",
          instances: parentId ? (children.get(parentId) ?? []) : rootInstances(),
        };
      }
      case "force": {
        const forceId = instance.forceInstanceId ?? rootAncestor(instance)?.id ?? null;
        if (!forceId) return { state: "unknown", code: "MISSING_FORCE_SCOPE" };
        return {
          state: "known",
          instances: instances.filter(
            (candidate) => candidate.id === forceId || candidate.forceInstanceId === forceId,
          ),
        };
      }
      case "roster":
        return { state: "known", instances };
      case "root-entry": {
        const root = rootAncestor(instance);
        return root
          ? { state: "known", instances: descendantsIncluding(root) }
          : { state: "unknown", code: "MISSING_ROOT_SCOPE" };
      }
      default: {
        const resolved = resolveEntityToken(scope);
        if (resolved.state === "unknown" || !resolved.entityId)
          return { state: "unknown", code: "UNRESOLVED_ENTITY_SCOPE" };
        return {
          state: "known",
          instances: instances.filter((candidate) =>
            instanceMatches(candidate, resolved.entityId!),
          ),
        };
      }
    }
  }

  function rootInstances(): readonly RosterSelectionInstance[] {
    return roster.rootInstanceIds
      .map((id) => roster.instances[id])
      .filter((instance): instance is RosterSelectionInstance => Boolean(instance));
  }

  function rootAncestor(instance: RosterSelectionInstance): RosterSelectionInstance | null {
    let current: RosterSelectionInstance | undefined = instance;
    const visited = new Set<string>();
    while (current?.parentInstanceId) {
      if (visited.has(current.id)) return null;
      visited.add(current.id);
      current = roster.instances[current.parentInstanceId];
    }
    return current ?? null;
  }

  function descendantsIncluding(root: RosterSelectionInstance): RosterSelectionInstance[] {
    const result: RosterSelectionInstance[] = [];
    const pending = [root];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const current = pending.shift()!;
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      result.push(current);
      pending.push(...(children.get(current.id) ?? []));
    }
    return result.sort(compareInstance);
  }

  function instanceMatches(instance: RosterSelectionInstance, targetId: EntityId): boolean {
    if (instance.definitionId === targetId) return true;
    const entity = catalog.entities[instance.definitionId];
    if (entity?.categoryIds.includes(targetId)) return true;
    const placement = instance.placementId ? catalog.placements[instance.placementId] : undefined;
    return placement?.overlay.categoryIds.includes(targetId) ?? false;
  }

  function resolveEntityToken(token: string | null):
    | {
        readonly state: "known";
        readonly entityId: EntityId | null;
        readonly kind: DomainEntity["kind"] | null;
      }
    | { readonly state: "unknown"; readonly code: string } {
    if (
      !token ||
      ["forces", "selections", "limit::selection", "limit::category", "cost", "name"].includes(
        token,
      )
    )
      return { state: "known", entityId: null, kind: null };
    const direct = catalog.entities[token];
    if (direct) return { state: "known", entityId: direct.id, kind: direct.kind };
    const candidates = upstreamEntities.get(token) ?? [];
    if (candidates.length !== 1)
      return {
        state: "unknown",
        code: candidates.length > 1 ? "AMBIGUOUS_ENTITY_TOKEN" : "UNRESOLVED_ENTITY_TOKEN",
      };
    const entity = catalog.entities[candidates[0]!];
    return { state: "known", entityId: entity!.id, kind: entity!.kind };
  }

  function rawCostMetric(
    population: readonly RosterSelectionInstance[],
    costTypeId: EntityId | null,
  ): Numeric {
    let value = zeroDecimal();
    for (const candidate of population) {
      const entity = catalog.entities[candidate.definitionId];
      if (!entity) continue;
      const placement = candidate.placementId
        ? catalog.placements[candidate.placementId]
        : undefined;
      for (const id of [...entity.costIds, ...(placement?.overlay.costIds ?? [])]) {
        const cost = catalog.entities[id];
        if (!cost || cost.kind !== "Cost" || cost.semantics.role === "limit") continue;
        if (costTypeId && cost.semantics.costTypeId !== costTypeId) continue;
        const parsed = decimalFromAmount(cost.amount);
        if (parsed.state === "unknown") return parsed;
        value = addDecimal(value, multiplyDecimalByInteger(parsed.value, candidate.quantity));
      }
    }
    return { state: "known", value };
  }

  function applyModifiers(
    base: DecimalValue,
    modifierIds: readonly EntityId[],
    instance: RosterSelectionInstance,
    applies: (modifier: Extract<DomainEntity, { kind: "Modifier" }>) => boolean,
  ): Numeric {
    let value = base;
    for (const modifierId of [...new Set(modifierIds)].sort()) {
      const modifier = catalog.entities[modifierId];
      if (!modifier || modifier.kind !== "Modifier")
        return { state: "unknown", code: "INVALID_MODIFIER_REFERENCE" };
      if (!applies(modifier)) continue;
      if (!modifier.expression.evaluable) return { state: "unknown", code: "UNEVALUABLE_MODIFIER" };
      const enabled = evaluateConditions(modifier.conditionIds, instance, new Set());
      if (enabled.state === "unknown") return enabled;
      if (enabled.state === "false") continue;
      const repetitions = modifierRepetitions(modifier, instance);
      if (repetitions.state === "unknown") return repetitions;
      const rawOperand =
        modifier.expression.value ??
        (["increment", "decrement"].includes(modifier.expression.operator ?? "") ? "1" : null);
      const operand = rawOperand ? parseDecimal(rawOperand) : null;
      if (!operand) return { state: "unknown", code: "INVALID_MODIFIER_VALUE" };
      switch (modifier.expression.operator) {
        case "add":
        case "increment":
          value = addDecimal(value, multiplyDecimalByInteger(operand, repetitions.value));
          break;
        case "decrement":
          value = addDecimal(value, multiplyDecimalByInteger(operand, -repetitions.value));
          break;
        case "multiply":
          for (let index = 0; index < repetitions.value; index += 1)
            value = multiplyDecimal(value, operand);
          break;
        case "set":
          value = operand;
          break;
        default:
          return { state: "unknown", code: "UNSUPPORTED_MODIFIER_OPERATOR" };
      }
    }
    return { state: "known", value };
  }

  function modifierRepetitions(
    modifier: Extract<DomainEntity, { kind: "Modifier" }>,
    instance: RosterSelectionInstance,
  ):
    | { readonly state: "known"; readonly value: number }
    | { readonly state: "unknown"; readonly code: string } {
    if (modifier.repeatIds.length === 0) return { state: "known", value: 1 };
    let repetitions = 1;
    for (const repeatId of [...modifier.repeatIds].sort()) {
      const repeat = catalog.entities[repeatId];
      if (!repeat || repeat.kind !== "Repeat" || !repeat.expression.evaluable)
        return { state: "unknown", code: "UNEVALUABLE_REPEAT" };
      const enabled = evaluateConditions(repeat.conditionIds, instance, new Set());
      if (enabled.state === "unknown") return enabled;
      if (enabled.state === "false") continue;
      const metric = metricForExpression(repeat.expression, instance);
      if (metric.state === "unknown") return metric;
      const raw = decimalToString(metric.value);
      if (!/^\d+$/u.test(raw)) return { state: "unknown", code: "INVALID_REPEAT_COUNT" };
      const count = Number(raw);
      if (!Number.isSafeInteger(count)) return { state: "unknown", code: "INVALID_REPEAT_COUNT" };
      repetitions *= count;
    }
    return { state: "known", value: repetitions };
  }

  function modifierTargetsCost(
    modifier: Extract<DomainEntity, { kind: "Modifier" }>,
    cost: Cost,
  ): boolean {
    const field = modifier.expression.field;
    if (field === null || field === "cost") return true;
    if (field === cost.id || field === cost.identity.upstreamId) return true;
    if (field === cost.semantics.costTypeId || field === cost.semantics.sourceCostTypeId)
      return true;
    const resolved = resolveEntityToken(field);
    return resolved.state === "known" && resolved.entityId === cost.semantics.costTypeId;
  }

  function decimalFromAmount(amount: CostAmount): Numeric {
    if (amount.state === "zero") return { state: "known", value: zeroDecimal() };
    if (amount.state === "value") {
      const value = parseDecimal(amount.value);
      return value ? { state: "known", value } : { state: "unknown", code: "INVALID_DECIMAL" };
    }
    return { state: "unknown", code: `COST_${amount.state.toUpperCase().replace("-", "_")}` };
  }

  function decimalFromCardinality(amount: CostAmount): DecimalValue | null {
    const parsed = decimalFromAmount(amount);
    return parsed.state === "known" ? parsed.value : null;
  }

  function indeterminateExpression(
    code: string,
    instance: RosterSelectionInstance,
    sourceEntityId: EntityId,
    slotIdValue: SlotId | null = null,
  ): void {
    addProblem(
      code,
      "indeterminate",
      "A catalogue expression cannot be evaluated safely.",
      { ...targetFor(instance), slotId: slotIdValue },
      sourceEntityId,
      null,
      "supported, resolved expression",
    );
  }

  function addProblem(
    code: string,
    severity: ProblemSeverity,
    message: string,
    target: ProblemTarget,
    sourceEntityId: EntityId | null,
    actual: string | null,
    expected: string | null,
  ): void {
    const id = [
      code,
      target.instanceId ?? "roster",
      target.entityId ?? "entity",
      target.placementId ?? "placement",
      target.slotId ?? "slot",
      sourceEntityId ?? "source",
    ].join(":");
    if (problems.has(id)) return;
    problems.set(id, {
      id,
      code,
      severity,
      message,
      target,
      sourceEntityId,
      actual,
      expected,
    });
  }

  function targetFor(instance: RosterSelectionInstance): ProblemTarget {
    return {
      instanceId: instance.id,
      entityId: instance.definitionId,
      placementId: instance.placementId,
      slotId: instance.slotId,
    };
  }
}

function compareInstance(left: RosterSelectionInstance, right: RosterSelectionInstance): number {
  return left.id.localeCompare(right.id);
}

function comparePlacement(left: Placement, right: Placement): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function compareProblem(left: RosterProblem, right: RosterProblem): number {
  const rank: Record<ProblemSeverity, number> = { indeterminate: 0, error: 1, warning: 2 };
  return rank[left.severity] - rank[right.severity] || left.id.localeCompare(right.id);
}
