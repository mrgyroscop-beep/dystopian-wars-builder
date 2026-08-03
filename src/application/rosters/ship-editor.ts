import type {
  DomainCatalog,
  DomainEntity,
  EntityId,
  Placement,
  Slot,
  SlotId,
} from "../../domain/catalog";
import {
  evaluateRoster,
  rosterInstanceId,
  type RosterEvaluation,
  type RosterInstanceId,
  type RosterSelectionInstance,
  type RosterSnapshot,
} from "../../domain/roster";
import { projectShipProfileRules, type ShipProfileRulesReadModel } from "./profile-rules";

export type ShipEditorGroupId = string;
export type ShipEditorDataState =
  "ready" | "loading" | "load-error" | "missing-reference" | "unsupported-data";

export interface ShipEditorOptionReadModel {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly costLabel: string;
  readonly selectedQuantity: number;
  readonly availability: "available" | "unavailable" | "indeterminate";
  readonly reason: string | null;
}

export interface ShipEditorGroupReadModel {
  readonly id: ShipEditorGroupId;
  readonly label: string;
  readonly help: string;
  readonly scope: "unit" | "fleet";
  readonly control: "exclusive" | "quantity";
  readonly minimum: number;
  readonly maximum: number;
  readonly options: readonly ShipEditorOptionReadModel[];
}

export interface ShipEditorProblemReadModel {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly targetGroupId: ShipEditorGroupId | null;
  readonly targetGroupLabel: string;
}

export interface ShipEditorReadyReadModel {
  readonly dataState: "ready";
  readonly mode: "preview" | "instance";
  readonly instanceId: string | null;
  readonly name: string;
  readonly basePoints: string;
  readonly optionPoints: string;
  readonly derivedPoints: string;
  readonly totalPoints: string;
  readonly victoryPoints: string;
  readonly mandatory: { readonly selected: number; readonly required: number };
  readonly validity: "valid" | "invalid" | "indeterminate";
  readonly persistence: "saved-local" | "unsaved" | "saving" | "save-error";
  readonly system: "ready" | "unavailable";
  readonly groups: readonly ShipEditorGroupReadModel[];
  readonly fleetGroups: readonly ShipEditorGroupReadModel[];
  readonly modelQuantity: {
    readonly instanceId: string | null;
    readonly value: number;
    readonly minimum: number;
    readonly maximum: number;
    readonly fixed: boolean;
  };
  readonly problems: readonly ShipEditorProblemReadModel[];
  readonly breakdown: readonly { readonly label: string; readonly value: string }[];
  readonly profileRules: ShipProfileRulesReadModel;
}

export interface ShipEditorUnavailableReadModel {
  readonly dataState: Exclude<ShipEditorDataState, "ready">;
  readonly title: string;
  readonly detail: string;
}

export type ShipEditorReadModel = ShipEditorReadyReadModel | ShipEditorUnavailableReadModel;

export type ShipEditorCommand =
  | {
      readonly type: "replace-exclusive";
      readonly instanceId: string;
      readonly groupId: ShipEditorGroupId;
      readonly optionId: string;
    }
  | {
      readonly type: "set-choice-quantity";
      readonly instanceId: string;
      readonly groupId: ShipEditorGroupId;
      readonly optionId: string;
      readonly quantity: number;
    }
  | {
      readonly type: "set-model-quantity";
      readonly instanceId: string;
      readonly quantity: number;
    };

export class ShipEditorCommandError extends Error {
  constructor(
    readonly code:
      | "UNKNOWN_INSTANCE"
      | "UNKNOWN_GROUP"
      | "UNKNOWN_OPTION"
      | "UNAVAILABLE"
      | "INDETERMINATE"
      | "OUT_OF_RANGE",
    message: string,
  ) {
    super(message);
    this.name = "ShipEditorCommandError";
  }
}

export function isShipEditorDefinition(catalog: DomainCatalog, definitionId: string): boolean {
  return Boolean(editorModelPlacement(catalog, definitionId));
}

export function materializeShipStructure(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  unit: RosterSelectionInstance,
  createId: () => string,
): RosterSnapshot {
  const placement = editorModelPlacement(catalog, unit.definitionId);
  if (!placement?.definitionId) return snapshot;
  let materialized = snapshot;
  const modelExists = Object.values(snapshot.instances).some(
    (candidate) => candidate.parentInstanceId === unit.id && candidate.placementId === placement.id,
  );
  if (!modelExists) {
    const id = freshId(snapshot.instances, createId);
    const quantity = placementCardinality(placement)?.minimum ?? 1;
    materialized = {
      ...snapshot,
      instances: {
        ...snapshot.instances,
        [id]: selection(
          id,
          placement.definitionId,
          placement.id,
          null,
          unit.id,
          unit.forceInstanceId ?? unit.id,
          quantity,
        ),
      },
    };
  }
  return materializeMinimumOptions(materialized, catalog, unit);
}

export function applyShipEditorCommand(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  command: ShipEditorCommand,
  createId: () => string,
): RosterSnapshot {
  if (command.type === "set-model-quantity")
    return setModelQuantity(snapshot, catalog, command.instanceId, command.quantity);
  const unit = snapshot.instances[command.instanceId];
  if (!unit || !isShipEditorDefinition(catalog, unit.definitionId))
    throw new ShipEditorCommandError("UNKNOWN_INSTANCE", "Редактируемый корабль не найден.");
  const evaluation = evaluateRoster(catalog, snapshot);
  const context = resolveGroupContext(snapshot, catalog, evaluation, unit, command.groupId);
  if (!context)
    throw new ShipEditorCommandError("UNKNOWN_GROUP", "Группа конфигурации не найдена.");
  const placement = catalog.placements[command.optionId];
  if (
    !placement ||
    !context.slot.optionPlacementIds.includes(placement.id) ||
    !placement.definitionId
  )
    throw new ShipEditorCommandError("UNKNOWN_OPTION", "Опция конфигурации не найдена.");
  const availability = evaluation.availability.find(
    (candidate) =>
      candidate.ownerInstanceId === context.owner.id && candidate.placementId === placement.id,
  );
  const existing = Object.values(snapshot.instances).some(
    (candidate) =>
      candidate.parentInstanceId === context.owner.id && candidate.placementId === placement.id,
  );
  const replacingAtCapacity =
    command.type === "replace-exclusive" &&
    availability?.reasonCodes.length &&
    availability.reasonCodes.every((reason) => reason === "SLOT_MAX_REACHED");
  if (!existing && availability?.state === "unavailable" && !replacingAtCapacity)
    throw new ShipEditorCommandError(
      "UNAVAILABLE",
      placement.overlay.attributes["editor.unavailableReason"] ?? "Опция недоступна.",
    );
  if (!existing && availability?.state === "indeterminate")
    throw new ShipEditorCommandError(
      "INDETERMINATE",
      "Доступность опции невозможно безопасно определить.",
    );
  const bounds =
    evaluatedCardinality(evaluation, context.owner.id, context.slot.id) ??
    cardinality(context.slot);
  if (!bounds) throw new ShipEditorCommandError("INDETERMINATE", "Границы группы неизвестны.");
  const quantity = command.type === "replace-exclusive" ? 1 : command.quantity;
  if (!Number.isSafeInteger(quantity) || quantity < bounds.minimum || quantity > bounds.maximum)
    throw new ShipEditorCommandError(
      "OUT_OF_RANGE",
      `Допустимое количество для ${context.slot.label.plainText}: ${bounds.minimum}–${bounds.maximum}.`,
    );
  if (command.type === "replace-exclusive" && bounds.maximum !== 1)
    throw new ShipEditorCommandError("UNKNOWN_GROUP", "Группа не является взаимоисключающей.");

  const instances = { ...snapshot.instances };
  for (const candidate of Object.values(instances)) {
    if (candidate.parentInstanceId !== context.owner.id || candidate.slotId !== context.slot.id)
      continue;
    if (command.type === "replace-exclusive" || candidate.placementId === placement.id)
      delete instances[candidate.id];
  }
  if (quantity > 0) {
    const id = freshId(instances, createId);
    instances[id] = selection(
      id,
      placement.definitionId,
      placement.id,
      context.slot.id,
      context.owner.id,
      unit.forceInstanceId ?? unit.id,
      quantity,
    );
  }
  const candidate = { ...snapshot, instances };
  if (evaluateRoster(catalog, candidate).status === "indeterminate")
    throw new ShipEditorCommandError(
      "INDETERMINATE",
      "Каталог не позволяет безопасно проверить эту конфигурацию.",
    );
  return candidate;
}

export function projectShipEditor(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  instanceId: string | null,
  definitionId: string | null,
  persistence: ShipEditorReadyReadModel["persistence"],
): ShipEditorReadModel {
  const storedUnit = instanceId ? snapshot.instances[instanceId] : null;
  const targetDefinitionId = storedUnit?.definitionId ?? definitionId;
  if (!targetDefinitionId || !catalog.entities[targetDefinitionId])
    return unavailable(
      "missing-reference",
      "Корабль не найден",
      "Ссылка на определение отсутствует в каталоге.",
    );
  const modelPlacement = editorModelPlacement(catalog, targetDefinitionId);
  if (!modelPlacement)
    return unavailable(
      "unsupported-data",
      "Настройка недоступна",
      "Каталог не содержит структурную Model с настраиваемыми Slots.",
    );
  if (!modelPlacement.definitionId || !catalog.entities[modelPlacement.definitionId])
    return unavailable(
      "missing-reference",
      "Неполная структура",
      "Структурная Model не разрешается в каталоге.",
    );

  const projected = storedUnit
    ? { snapshot, unit: storedUnit }
    : previewSnapshot(snapshot, catalog, targetDefinitionId, modelPlacement);
  const evaluation = evaluateRoster(catalog, projected.snapshot);
  const modelInstance = Object.values(projected.snapshot.instances).find(
    (candidate) =>
      candidate.parentInstanceId === projected.unit.id &&
      candidate.placementId === modelPlacement.id,
  );
  if (!modelInstance)
    return unavailable(
      "missing-reference",
      "Неполная структура",
      "Экземпляр структурной Model отсутствует в составе.",
    );
  const declaredUnitSlots = slotsForDefinition(catalog, modelInstance.definitionId).filter(
    (slot) => slot.kind !== "Doctrine",
  );
  if (declaredUnitSlots.length === 0)
    return unavailable(
      "unsupported-data",
      "Настройка недоступна",
      "Для структурной Model не опубликованы поддерживаемые Slots.",
    );
  const unitSlots = declaredUnitSlots.filter((slot) =>
    isControllableSlot(evaluation, modelInstance, slot),
  );
  const fleetOwner = projected.unit.forceInstanceId
    ? projected.snapshot.instances[projected.unit.forceInstanceId]
    : null;
  const fleetSlots = fleetOwner
    ? slotsForDefinition(catalog, fleetOwner.definitionId).filter(
        (slot) => slot.kind === "Doctrine" && isControllableSlot(evaluation, fleetOwner, slot),
      )
    : [];
  const groups = unitSlots.map((slot) =>
    projectGroup(projected.snapshot, catalog, evaluation, modelInstance, slot, "unit"),
  );
  const fleetGroups = fleetOwner
    ? fleetSlots.map((slot) =>
        projectGroup(projected.snapshot, catalog, evaluation, fleetOwner, slot, "fleet"),
      )
    : [];
  const allGroups = [...groups, ...fleetGroups];
  const relevantIds = descendantsIncluding(projected.snapshot, projected.unit.id);
  if (fleetOwner) relevantIds.add(fleetOwner.id);
  const relevantProblems = evaluation.problems.filter(
    (problem) =>
      !["SLOT_MIN_NOT_MET", "CONSTRAINT_MIN_NOT_MET"].includes(problem.code) &&
      ((problem.target.instanceId && relevantIds.has(problem.target.instanceId)) ||
        (problem.target.slotId && allGroups.some((group) => group.id === problem.target.slotId))),
  );
  const projectedEvaluationProblems = relevantProblems.map((problem) => {
    const source = problem.sourceEntityId ? catalog.entities[problem.sourceEntityId] : null;
    const targetGroupId =
      problem.target.slotId ??
      (source && "expression" in source ? source.expression.flags["targetSlotId"] : undefined) ??
      null;
    const targetGroup = allGroups.find((group) => group.id === targetGroupId) ?? null;
    return {
      id: problem.id,
      title:
        problem.code === "ACTIVE_ERROR_MODIFIER"
          ? problem.message
          : `${targetGroup?.label ?? "Настройка корабля"}: требует внимания`,
      detail: problem.message,
      targetGroupId: targetGroup?.id ?? null,
      targetGroupLabel: targetGroup?.label ?? "настройке корабля",
    };
  });
  const mandatoryProblems: ShipEditorProblemReadModel[] = groups.flatMap((group) => {
    const selected = group.options.reduce((sum, option) => sum + option.selectedQuantity, 0);
    if (selected >= group.minimum) return [];
    return [
      {
        id: `mandatory:${group.id}`,
        title: `${group.label}: требуется выбор`,
        detail: `Выбрано ${selected}; требуется минимум ${group.minimum}.`,
        targetGroupId: group.id,
        targetGroupLabel: group.label,
      },
    ];
  });
  const problems = dedupeProblems([...projectedEvaluationProblems, ...mandatoryProblems]);
  const contributionIds = descendantsIncluding(projected.snapshot, projected.unit.id);
  const contributions = evaluation.contributions.filter((entry) =>
    contributionIds.has(entry.instanceId),
  );
  const optionPoints = sumContributions(contributions, "points", "delta");
  const totalPoints = sumContributions(contributions, "points");
  const victoryPoints = sumContributions(contributions, "victory-points");
  const basePoints =
    rawBaseCost(catalog, targetDefinitionId, "points") +
    rawBaseCost(catalog, modelPlacement.definitionId, "points");
  const derivedPoints = totalPoints - basePoints - optionPoints;
  const hardpoints = groups.filter((group) => group.control === "exclusive");
  const required = hardpoints.reduce((sum, group) => sum + group.minimum, 0);
  const selected = hardpoints.reduce(
    (sum, group) =>
      sum +
      Math.min(
        group.minimum,
        group.options.reduce((value, option) => value + option.selectedQuantity, 0),
      ),
    0,
  );
  const validity = relevantProblems.some((problem) => problem.severity === "indeterminate")
    ? "indeterminate"
    : relevantProblems.some((problem) => problem.severity === "error") || mandatoryProblems.length
      ? "invalid"
      : "valid";
  const modelBounds = placementCardinality(modelPlacement);
  if (!modelBounds)
    return unavailable(
      "unsupported-data",
      "Количество моделей неизвестно",
      "Каталог не содержит безопасно интерпретируемую cardinality для структурной Model.",
    );
  const { minimum, maximum } = modelBounds;
  return {
    dataState: "ready",
    mode: storedUnit ? "instance" : "preview",
    instanceId: storedUnit?.id ?? null,
    name: catalog.entities[targetDefinitionId].label.plainText,
    basePoints: String(basePoints),
    optionPoints: String(optionPoints),
    derivedPoints: String(derivedPoints),
    totalPoints: String(totalPoints),
    victoryPoints: String(victoryPoints),
    mandatory: { selected, required },
    validity,
    persistence,
    system: "ready",
    groups,
    fleetGroups,
    modelQuantity: {
      instanceId: modelInstance?.id ?? null,
      value: modelInstance?.quantity ?? minimum,
      minimum,
      maximum,
      fixed: minimum === maximum,
    },
    problems,
    profileRules: projectShipProfileRules(
      projected.snapshot,
      catalog,
      projected.unit,
      modelInstance,
    ),
    breakdown: [
      { label: "Базовая стоимость", value: String(basePoints) },
      { label: "Выбранные опции", value: signed(optionPoints) },
      ...(derivedPoints
        ? [{ label: "Производные изменения каталога", value: signed(derivedPoints) }]
        : []),
    ],
  };
}

function projectGroup(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  evaluation: RosterEvaluation,
  owner: RosterSelectionInstance,
  slot: Slot,
  scope: "unit" | "fleet",
): ShipEditorGroupReadModel {
  const bounds = evaluatedCardinality(evaluation, owner.id, slot.id) ??
    cardinality(slot) ?? { minimum: 0, maximum: 0 };
  return {
    id: slot.id,
    label: slot.label.plainText,
    help: `${slot.kind}: допустимо ${bounds.minimum}–${bounds.maximum}.`,
    scope,
    control: bounds.minimum === 1 && bounds.maximum === 1 ? "exclusive" : "quantity",
    minimum: bounds.minimum,
    maximum: bounds.maximum,
    options: slot.optionPlacementIds.map((placementId) => {
      const placement = catalog.placements[placementId];
      const definition = placement?.definitionId ? catalog.entities[placement.definitionId] : null;
      const selected = Object.values(snapshot.instances)
        .filter(
          (candidate) =>
            candidate.parentInstanceId === owner.id && candidate.placementId === placementId,
        )
        .reduce((sum, candidate) => sum + candidate.quantity, 0);
      const availability = evaluation.availability.find(
        (candidate) =>
          candidate.ownerInstanceId === owner.id && candidate.placementId === placementId,
      );
      const replaceableAtCapacity =
        bounds.minimum === 1 &&
        bounds.maximum === 1 &&
        availability?.state === "unavailable" &&
        availability.reasonCodes.length > 0 &&
        availability.reasonCodes.every((reason) => reason === "SLOT_MAX_REACHED");
      const availabilityState = replaceableAtCapacity
        ? "available"
        : (availability?.state ?? "indeterminate");
      return {
        id: placementId,
        label: definition?.label.plainText ?? "Неизвестная опция",
        kind: definition?.kind ?? "Unknown",
        costLabel: optionCostLabel(catalog, definition ?? null, placement),
        selectedQuantity: selected,
        availability: availabilityState,
        reason:
          availabilityState === "available"
            ? null
            : (placement?.overlay.attributes["editor.unavailableReason"] ??
              (availability?.reasonCodes.join(", ") || "Недостаточно данных каталога.")),
      };
    }),
  };
}

function resolveGroupContext(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  evaluation: RosterEvaluation,
  unit: RosterSelectionInstance,
  groupId: string,
): { readonly owner: RosterSelectionInstance; readonly slot: Slot } | null {
  const slot = catalog.slots[groupId];
  if (!slot) return null;
  const placement = editorModelPlacement(catalog, unit.definitionId);
  const model = placement
    ? Object.values(snapshot.instances).find(
        (candidate) =>
          candidate.parentInstanceId === unit.id && candidate.placementId === placement.id,
      )
    : null;
  if (
    model &&
    slotsForDefinition(catalog, model.definitionId).some((candidate) => candidate.id === slot.id) &&
    isControllableSlot(evaluation, model, slot)
  )
    return { owner: model, slot };
  const fleet = unit.forceInstanceId ? snapshot.instances[unit.forceInstanceId] : null;
  if (
    fleet &&
    slotsForDefinition(catalog, fleet.definitionId).some((candidate) => candidate.id === slot.id) &&
    isControllableSlot(evaluation, fleet, slot)
  )
    return { owner: fleet, slot };
  return null;
}

function setModelQuantity(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  instanceId: string,
  quantity: number,
): RosterSnapshot {
  const model = snapshot.instances[instanceId];
  const definition = model ? catalog.entities[model.definitionId] : null;
  if (!model || definition?.kind !== "Model")
    throw new ShipEditorCommandError("UNKNOWN_INSTANCE", "Структурная Model не найдена.");
  const placement = model.placementId ? catalog.placements[model.placementId] : null;
  const bounds = placement ? placementCardinality(placement) : null;
  if (!bounds)
    throw new ShipEditorCommandError(
      "INDETERMINATE",
      "Каталог не содержит безопасно интерпретируемую cardinality для Model.",
    );
  const { minimum, maximum } = bounds;
  if (!Number.isSafeInteger(quantity) || quantity < minimum || quantity > maximum)
    throw new ShipEditorCommandError(
      "OUT_OF_RANGE",
      `Допустимое количество Model: ${minimum}–${maximum}.`,
    );
  const candidate = {
    ...snapshot,
    instances: { ...snapshot.instances, [model.id]: { ...model, quantity } },
  };
  if (evaluateRoster(catalog, candidate).status === "indeterminate")
    throw new ShipEditorCommandError("INDETERMINATE", "Количество Model нельзя проверить.");
  return candidate;
}

function editorModelPlacement(catalog: DomainCatalog, definitionId: string): Placement | null {
  return (
    Object.values(catalog.placements)
      .filter(
        (placement) =>
          placement.ownerId === definitionId &&
          placement.definitionId &&
          catalog.entities[placement.definitionId]?.kind === "Model",
      )
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))[0] ?? null
  );
}

function slotsForDefinition(catalog: DomainCatalog, definitionId: string): Slot[] {
  const ids = new Set<SlotId>();
  for (const id of catalog.entities[definitionId]?.slotIds ?? []) ids.add(id);
  for (const placement of Object.values(catalog.placements)) {
    if (placement.ownerId !== definitionId || !placement.definitionId) continue;
    for (const id of catalog.entities[placement.definitionId]?.slotIds ?? []) ids.add(id);
  }
  return [...ids].map((id) => catalog.slots[id]).filter((slot): slot is Slot => Boolean(slot));
}

function previewSnapshot(
  source: RosterSnapshot,
  catalog: DomainCatalog,
  definitionId: string,
  modelPlacement: Placement,
): { readonly snapshot: RosterSnapshot; readonly unit: RosterSelectionInstance } {
  const unitId = rosterInstanceId("preview-unit");
  const modelId = rosterInstanceId("preview-model");
  const unit = selection(unitId, definitionId, null, null, null, unitId, 1);
  const model = selection(
    modelId,
    modelPlacement.definitionId!,
    modelPlacement.id,
    null,
    unitId,
    unitId,
    placementCardinality(modelPlacement)?.minimum ?? 1,
  );
  const preview = {
    contractVersion: 1 as const,
    id: `preview-${source.id}`,
    catalogContentVersion: source.catalogContentVersion,
    rootInstanceIds: [unitId],
    instances: { [unitId]: unit, [modelId]: model },
  };
  return {
    unit,
    snapshot: materializeMinimumOptions(preview, catalog, unit),
  };
}

function materializeMinimumOptions(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  unit: RosterSelectionInstance,
): RosterSnapshot {
  let current = snapshot;
  const blocked = new Set<string>();
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const evaluation = evaluateRoster(catalog, current);
    const owners = descendantsIncluding(current, unit.id);
    const target = evaluation.slots.find((candidate) => {
      const minimum = candidate.minimum === null ? null : Number(candidate.minimum);
      return (
        owners.has(candidate.ownerInstanceId) &&
        candidate.visibility === "visible" &&
        !candidate.helper &&
        minimum !== null &&
        Number.isSafeInteger(minimum) &&
        candidate.selected < minimum &&
        !blocked.has(`${candidate.ownerInstanceId}:${candidate.slotId}`)
      );
    });
    if (!target) break;
    const slot = catalog.slots[target.slotId];
    const owner = current.instances[target.ownerInstanceId];
    if (!slot || !owner || target.minimum === null) {
      blocked.add(`${target.ownerInstanceId}:${target.slotId}`);
      continue;
    }
    const placement = slot.optionPlacementIds
      .map((id) => catalog.placements[id])
      .filter((candidate): candidate is Placement => Boolean(candidate?.definitionId))
      .filter((candidate) =>
        evaluation.availability.some(
          (availability) =>
            availability.ownerInstanceId === owner.id &&
            availability.placementId === candidate.id &&
            availability.state === "available",
        ),
      )
      .sort(
        (left, right) =>
          baseOptionPoints(catalog, left) - baseOptionPoints(catalog, right) ||
          left.order - right.order ||
          left.id.localeCompare(right.id),
      )[0];
    if (!placement?.definitionId) {
      blocked.add(`${target.ownerInstanceId}:${target.slotId}`);
      continue;
    }
    const minimum = Number(target.minimum);
    const quantity = Math.max(1, minimum - target.selected);
    const id = baseOptionInstanceId(current.instances, unit.id, placement.id);
    current = {
      ...current,
      instances: {
        ...current.instances,
        [id]: selection(
          id,
          placement.definitionId,
          placement.id,
          slot.id,
          owner.id,
          unit.forceInstanceId ?? unit.id,
          quantity,
        ),
      },
    };
  }
  return current;
}

function baseOptionInstanceId(
  instances: Readonly<Record<string, RosterSelectionInstance>>,
  unitId: string,
  placementIdValue: string,
): RosterInstanceId {
  const seed = `${unitId}:${placementIdValue}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  const base = `${unitId.replace(/[^a-zA-Z0-9_-]/gu, "-")}-base-${(hash >>> 0).toString(36)}`;
  for (let suffix = 0; suffix < 100; suffix += 1) {
    const id = rosterInstanceId(suffix === 0 ? base : `${base}-${suffix}`);
    if (!instances[id]) return id;
  }
  throw new Error("Base loadout could not produce a unique instance ID");
}

function baseOptionPoints(catalog: DomainCatalog, placement: Placement): number {
  const definition = placement.definitionId ? catalog.entities[placement.definitionId] : null;
  return [...(definition?.costIds ?? []), ...placement.overlay.costIds].reduce((sum, id) => {
    const cost = catalog.entities[id];
    if (
      cost?.kind !== "Cost" ||
      cost.semantics.resource !== "points" ||
      (cost.amount.state !== "value" && cost.amount.state !== "zero")
    )
      return sum;
    return sum + Number(cost.amount.value);
  }, 0);
}

function cardinality(slot: Slot): { readonly minimum: number; readonly maximum: number } | null {
  const minimum = amountNumber(slot.cardinality.minimum);
  const maximum = amountNumber(slot.cardinality.maximum);
  return minimum === null || maximum === null ? null : { minimum, maximum };
}

function placementCardinality(
  placement: Placement,
): { readonly minimum: number; readonly maximum: number } | null {
  const source = placement.overlay.cardinality;
  if (!source) return null;
  const minimum = amountNumber(source.minimum);
  const maximum = amountNumber(source.maximum);
  return minimum === null || maximum === null || minimum < 1 || maximum < minimum
    ? null
    : { minimum, maximum };
}

function isControllableSlot(
  evaluation: RosterEvaluation,
  owner: RosterSelectionInstance,
  slot: Slot,
): boolean {
  const effective = evaluation.slots.find(
    (candidate) => candidate.ownerInstanceId === owner.id && candidate.slotId === slot.id,
  );
  return effective?.visibility === "visible" && !effective.helper;
}

function evaluatedCardinality(
  evaluation: RosterEvaluation,
  ownerInstanceId: string,
  slotIdValue: string,
): { readonly minimum: number; readonly maximum: number } | null {
  const slot = evaluation.slots.find(
    (candidate) =>
      candidate.ownerInstanceId === ownerInstanceId && candidate.slotId === slotIdValue,
  );
  if (!slot || slot.minimum === null || slot.maximum === null) return null;
  const minimum = Number(slot.minimum);
  const maximum = Number(slot.maximum);
  return Number.isSafeInteger(minimum) &&
    minimum >= 0 &&
    Number.isSafeInteger(maximum) &&
    maximum >= minimum
    ? { minimum, maximum }
    : null;
}

function amountNumber(amount: Slot["cardinality"]["minimum"]): number | null {
  if (amount.state === "zero") return 0;
  if (amount.state !== "value") return null;
  const value = Number(amount.value);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function descendantsIncluding(snapshot: RosterSnapshot, rootId: string): Set<string> {
  const ids = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (ids.has(current)) continue;
    ids.add(current);
    pending.push(
      ...Object.values(snapshot.instances)
        .filter((candidate) => candidate.parentInstanceId === current)
        .map((candidate) => candidate.id),
    );
  }
  return ids;
}

function dedupeProblems(
  problems: readonly ShipEditorProblemReadModel[],
): ShipEditorProblemReadModel[] {
  const unique = new Map<string, ShipEditorProblemReadModel>();
  for (const problem of problems) {
    const key = `${problem.title}:${problem.detail}:${problem.targetGroupId ?? problem.targetGroupLabel}`;
    if (!unique.has(key)) unique.set(key, problem);
  }
  return [...unique.values()];
}

function sumContributions(
  contributions: RosterEvaluation["contributions"],
  resource: "points" | "victory-points",
  role?: "base" | "delta",
): number {
  return contributions
    .filter((entry) => entry.resource === resource && (!role || entry.role === role))
    .reduce((sum, entry) => sum + Number(entry.value), 0);
}

function rawBaseCost(
  catalog: DomainCatalog,
  definitionId: string,
  resource: "points" | "victory-points",
): number {
  const definition = catalog.entities[definitionId];
  return (definition?.costIds ?? []).reduce((sum, id) => {
    const candidate = catalog.entities[id];
    if (
      candidate?.kind !== "Cost" ||
      candidate.semantics.role !== "base" ||
      candidate.semantics.resource !== resource ||
      (candidate.amount.state !== "value" && candidate.amount.state !== "zero")
    )
      return sum;
    return sum + Number(candidate.amount.value);
  }, 0);
}

function optionCostLabel(
  catalog: DomainCatalog,
  definition: DomainEntity | null,
  placement: Placement | undefined,
): string {
  const ids = [...(definition?.costIds ?? []), ...(placement?.overlay.costIds ?? [])];
  const points = ids.reduce((sum, id) => {
    const candidate = catalog.entities[id];
    if (
      candidate?.kind !== "Cost" ||
      candidate.semantics.resource !== "points" ||
      (candidate.amount.state !== "value" && candidate.amount.state !== "zero")
    )
      return sum;
    return sum + Number(candidate.amount.value);
  }, 0);
  return points === 0 ? "Бесплатно" : `${signed(points)} Points`;
}

function unavailable(
  dataState: ShipEditorUnavailableReadModel["dataState"],
  title: string,
  detail: string,
): ShipEditorUnavailableReadModel {
  return { dataState, title, detail };
}

function selection(
  id: RosterInstanceId,
  definitionId: string,
  placementId: string | null,
  slotId: string | null,
  parentInstanceId: RosterInstanceId | null,
  forceInstanceId: RosterInstanceId,
  quantity: number,
): RosterSelectionInstance {
  return {
    contractVersion: 1,
    id,
    definitionId: definitionId as EntityId,
    placementId: placementId as RosterSelectionInstance["placementId"],
    slotId: slotId as RosterSelectionInstance["slotId"],
    parentInstanceId,
    forceInstanceId,
    quantity,
  };
}

function freshId(
  instances: Readonly<Record<string, RosterSelectionInstance>>,
  createId: () => string,
): RosterInstanceId {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = rosterInstanceId(createId());
    if (id && !instances[id]) return id;
  }
  throw new Error("Instance ID factory could not produce a unique ID");
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}
