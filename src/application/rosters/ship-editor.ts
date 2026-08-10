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
import {
  projectShipProfileRules,
  projectWeaponDefinition,
  type ShipProfileRulesReadModel,
  type WeaponProfileReadModel,
} from "./profile-rules";

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
  readonly description?: string | null;
  readonly profile?: WeaponProfileReadModel | null;
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
  readonly card?: {
    readonly role: string;
    readonly tags: readonly string[];
    readonly nation: string;
    readonly platform: string;
  };
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

export interface FleetDoctrineReadModel {
  readonly ownerInstanceId: string;
  readonly selectionMode: "one-total" | "one-per-group";
  readonly groups: readonly ShipEditorGroupReadModel[];
}

export interface FleetDoctrineCommand {
  readonly type: "set-fleet-doctrine";
  readonly instanceId: string;
  readonly optionId: string;
}

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

interface ShipEditorGroupContext {
  readonly owner: RosterSelectionInstance;
  readonly slot: Slot;
  readonly standalonePlacement: Placement | null;
}

interface StandaloneOptionContext {
  readonly slot: Slot;
  readonly placement: Placement;
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
    !(
      context.standalonePlacement?.id === placement.id ||
      directSlotOptionPlacements(catalog, context.slot).some(
        (candidate) => candidate.id === placement.id,
      )
    ) ||
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
  if (
    !context.standalonePlacement &&
    !existing &&
    availability?.state === "unavailable" &&
    !replacingAtCapacity
  )
    throw new ShipEditorCommandError(
      "UNAVAILABLE",
      placement.overlay.attributes["editor.unavailableReason"] ?? "Опция недоступна.",
    );
  if (!context.standalonePlacement && !existing && availability?.state === "indeterminate")
    throw new ShipEditorCommandError(
      "INDETERMINATE",
      "Доступность опции невозможно безопасно определить.",
    );
  const bounds = context.standalonePlacement
    ? optionalPlacementCardinality(context.standalonePlacement)
    : (evaluatedCardinality(evaluation, context.owner.id, context.slot.id) ??
      cardinality(context.slot));
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
    if (candidate.parentInstanceId !== context.owner.id) continue;
    if (context.standalonePlacement) {
      if (candidate.placementId !== placement.id) continue;
    } else if (candidate.slotId !== context.slot.id) continue;
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

export function projectFleetDoctrine(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
): FleetDoctrineReadModel | null {
  const owner = snapshot.rootInstanceIds
    .map((id) => snapshot.instances[id])
    .find(
      (instance) => instance && catalog.entities[instance.definitionId]?.kind === "Battlefleet",
    );
  if (!owner) return null;
  const inventory = fleetDoctrineInventory(catalog, owner.definitionId);
  if (!inventory.candidates.length) return null;
  const selectedDefinitions = new Set(
    Object.values(snapshot.instances)
      .filter((instance) => instance.forceInstanceId === owner.id)
      .map((instance) => instance.definitionId),
  );
  const selectedLabels = new Set(
    [...selectedDefinitions]
      .map((id) => catalog.entities[id]?.label.plainText)
      .filter((label): label is string => Boolean(label))
      .map(normalizeDoctrineLabel),
  );
  const grouped = new Map<string, FleetDoctrineCandidate[]>();
  for (const candidate of inventory.candidates) {
    const group = grouped.get(candidate.familyId) ?? [];
    group.push(candidate);
    grouped.set(candidate.familyId, group);
  }
  return {
    ownerInstanceId: owner.id,
    selectionMode: inventory.multipleManufacturers ? "one-per-group" : "one-total",
    groups: [...grouped.entries()].map(([familyId, candidates]) => ({
      id: `fleet-doctrine:${owner.definitionId}:${familyId}`,
      label: candidates[0]?.familyLabel ?? "Доктрина флота",
      help: inventory.multipleManufacturers
        ? "Можно выбрать по одной доктрине из каждой семьи. Более дешёвая из двух не увеличивает стоимость флота."
        : candidates.length === inventory.candidates.length
          ? "Выберите одну доктрину для всего Battlefleet."
          : "Выберите одну доктрину для всего Battlefleet — выбор в другой семье будет заменён.",
      scope: "fleet" as const,
      control: "exclusive" as const,
      minimum: 0,
      maximum: 1,
      options: candidates.map((candidate) => {
        const availability = fleetDoctrineAvailability(snapshot, catalog, owner, candidate);
        return {
          id: candidate.definition.id,
          label: candidate.definition.label.plainText,
          kind: candidate.definition.kind,
          costLabel: optionCostLabel(catalog, candidate.definition, candidate.placement),
          selectedQuantity:
            selectedDefinitions.has(candidate.definition.id) ||
            selectedLabels.has(normalizeDoctrineLabel(candidate.definition.label.plainText))
              ? 1
              : 0,
          availability: availability.state,
          reason: availability.reason,
          description: optionDescription(catalog, candidate.definition),
        };
      }),
    })),
  };
}

export function applyFleetDoctrineCommand(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  command: FleetDoctrineCommand,
  createId: () => string,
): RosterSnapshot {
  const owner = snapshot.instances[command.instanceId];
  if (!owner || catalog.entities[owner.definitionId]?.kind !== "Battlefleet")
    throw new ShipEditorCommandError("UNKNOWN_INSTANCE", "Battlefleet не найден.");
  const inventory = fleetDoctrineInventory(catalog, owner.definitionId);
  const option = inventory.candidates.find(
    (candidate) => candidate.definition.id === command.optionId,
  );
  if (!option)
    throw new ShipEditorCommandError("UNKNOWN_OPTION", "Доктрина недоступна для этого флота.");
  const availability = fleetDoctrineAvailability(snapshot, catalog, owner, option);
  if (availability.state !== "available")
    throw new ShipEditorCommandError(
      availability.state === "indeterminate" ? "INDETERMINATE" : "UNAVAILABLE",
      availability.reason ?? "Доктрина недоступна для текущего Battlefleet.",
    );
  const doctrineIds = new Set(
    inventory.rawCandidates
      .filter(
        (candidate) => !inventory.multipleManufacturers || candidate.familyId === option.familyId,
      )
      .map((candidate) => candidate.definition.id),
  );
  const instances = { ...snapshot.instances };
  for (const instance of Object.values(instances)) {
    if (instance.forceInstanceId === owner.id && doctrineIds.has(instance.definitionId))
      delete instances[instance.id];
  }
  const id = freshId(instances, createId);
  instances[id] = selection(
    id,
    option.definition.id,
    option.placement.id,
    option.placement.slotId,
    owner.id,
    owner.id,
    1,
  );
  return { ...snapshot, instances };
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
  const declaredModelSlots = slotsForDefinition(catalog, modelInstance.definitionId).filter(
    (slot) => slot.kind !== "Doctrine",
  );
  const modelSlotIds = new Set(declaredModelSlots.map((slot) => slot.id));
  const standaloneOptions = standaloneOptionsForDefinition(catalog, projected.unit.definitionId);
  const standaloneSlotIds = new Set(standaloneOptions.map(({ slot }) => slot.id));
  const declaredUnitSlots = slotsForDefinition(catalog, projected.unit.definitionId).filter(
    (slot) =>
      slot.kind !== "Doctrine" && !modelSlotIds.has(slot.id) && !standaloneSlotIds.has(slot.id),
  );
  if (
    declaredModelSlots.length === 0 &&
    declaredUnitSlots.length === 0 &&
    standaloneOptions.length === 0
  )
    return unavailable(
      "unsupported-data",
      "Настройка недоступна",
      "Для корабля не опубликованы поддерживаемые Slots.",
    );
  const modelSlots = declaredModelSlots.filter((slot) =>
    isControllableSlot(evaluation, modelInstance, slot),
  );
  const unitSlots = declaredUnitSlots.filter((slot) =>
    isControllableSlot(evaluation, projected.unit, slot),
  );
  const fleetOwner = projected.unit.forceInstanceId
    ? projected.snapshot.instances[projected.unit.forceInstanceId]
    : null;
  const fleetSlots = fleetOwner
    ? slotsForDefinition(catalog, fleetOwner.definitionId).filter(
        (slot) => slot.kind === "Doctrine" && isControllableSlot(evaluation, fleetOwner, slot),
      )
    : [];
  const groups = [
    ...modelSlots.map((slot) =>
      projectGroup(projected.snapshot, catalog, evaluation, modelInstance, slot, "unit"),
    ),
    ...unitSlots.map((slot) =>
      projectGroup(projected.snapshot, catalog, evaluation, projected.unit, slot, "unit"),
    ),
    ...standaloneOptions.map(({ slot, placement }) =>
      projectStandaloneGroup(projected.snapshot, catalog, projected.unit, slot, placement),
    ),
  ].filter(
    (group) =>
      group.options.length > 0 &&
      (group.maximum > 0 || group.options.some((option) => option.selectedQuantity > 0)),
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
  const unitDefinition = catalog.entities[targetDefinitionId];
  const categoryLabels = unitDefinition.categoryIds
    .map((id) => catalog.entities[id]?.label.plainText.trim() ?? "")
    .filter(Boolean);
  const cardTags = [
    unitDefinition.attributes.nation,
    unitDefinition.attributes.platform,
    unitDefinition.attributes.role,
    ...categoryLabels,
  ].filter(
    (value, index, values): value is string => Boolean(value) && values.indexOf(value) === index,
  );
  return {
    dataState: "ready",
    mode: storedUnit ? "instance" : "preview",
    instanceId: storedUnit?.id ?? null,
    name: unitDefinition.label.plainText,
    card: {
      role: unitDefinition.attributes.role || categoryLabels[0] || "Ship",
      tags: cardTags,
      nation: unitDefinition.attributes.nation || "",
      platform: unitDefinition.attributes.platform || "Surface",
    },
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
    options: directSlotOptionPlacements(catalog, slot).flatMap((placement) => {
      const placementId = placement.id;
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
        bounds.maximum === 1 &&
        availability?.state === "unavailable" &&
        availability.reasonCodes.length > 0 &&
        availability.reasonCodes.every((reason) => reason === "SLOT_MAX_REACHED");
      const availabilityState = replaceableAtCapacity
        ? "available"
        : (availability?.state ?? "indeterminate");
      const hiddenByCatalog =
        placement.overlay.attributes.hidden === "true" && availabilityState === "unavailable";
      if (
        selected === 0 &&
        (hiddenByCatalog || availability?.reasonCodes.includes("OPTION_HIDDEN"))
      )
        return [];
      return [
        {
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
                availabilityReason(availability?.reasonCodes ?? [])),
          description: optionDescription(catalog, definition ?? null),
          profile: projectWeaponDefinition(catalog, definition ?? null),
        },
      ];
    }),
  };
}

function projectStandaloneGroup(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  owner: RosterSelectionInstance,
  slot: Slot,
  placement: Placement,
): ShipEditorGroupReadModel {
  const bounds = optionalPlacementCardinality(placement) ?? { minimum: 0, maximum: 0 };
  const definition = placement.definitionId ? catalog.entities[placement.definitionId] : null;
  const selected = Object.values(snapshot.instances)
    .filter(
      (candidate) =>
        candidate.parentInstanceId === owner.id && candidate.placementId === placement.id,
    )
    .reduce((sum, candidate) => sum + candidate.quantity, 0);
  return {
    id: slot.id,
    label: slot.label.plainText,
    help: `${slot.kind}: допустимо ${bounds.minimum}–${bounds.maximum}.`,
    scope: "unit",
    control: bounds.minimum === 1 && bounds.maximum === 1 ? "exclusive" : "quantity",
    minimum: bounds.minimum,
    maximum: bounds.maximum,
    options: [
      {
        id: placement.id,
        label: definition?.label.plainText ?? slot.label.plainText,
        kind: definition?.kind ?? "Unknown",
        costLabel: optionCostLabel(catalog, definition ?? null, placement),
        selectedQuantity: selected,
        availability: "available",
        reason: null,
        description: optionDescription(catalog, definition ?? null),
        profile: projectWeaponDefinition(catalog, definition ?? null),
      },
    ],
  };
}

function optionDescription(catalog: DomainCatalog, definition: DomainEntity | null): string | null {
  if (!definition) return null;
  const descriptions = [
    definition.description?.plainText.trim() ?? "",
    ...definition.ruleIds.map((id) => {
      const rule = catalog.entities[id];
      return rule?.kind === "Rule" ? (rule.description?.plainText.trim() ?? "") : "";
    }),
  ].filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
  return descriptions.length ? descriptions.join("\n\n") : null;
}

interface FleetDoctrineCandidate {
  readonly placement: Placement;
  readonly definition: DomainEntity;
  readonly familyId: string;
  readonly familyLabel: string;
  readonly familyOrder: number;
}

interface FleetDoctrineInventory {
  readonly candidates: readonly FleetDoctrineCandidate[];
  readonly rawCandidates: readonly FleetDoctrineCandidate[];
  readonly multipleManufacturers: boolean;
}

function fleetDoctrineInventory(
  catalog: DomainCatalog,
  battlefleetDefinitionId: string,
): FleetDoctrineInventory {
  const battlefleet = catalog.entities[battlefleetDefinitionId];
  const defaultFamily = {
    id: "fleet",
    label: "Доктрина флота",
    order: 0,
  };
  const raw: FleetDoctrineCandidate[] = [];
  const add = (
    placement: Placement,
    family: { readonly id: string; readonly label: string; readonly order: number },
  ) => {
    const definition = placement.definitionId ? catalog.entities[placement.definitionId] : null;
    if (
      !definition ||
      !["Option", "Doctrine"].includes(definition.kind) ||
      /fleet\s+doctrines?/iu.test(definition.label.plainText) ||
      (!definition.ruleIds.length && !definition.description?.plainText.trim())
    )
      return;
    raw.push({
      placement,
      definition,
      familyId: family.id,
      familyLabel: family.label,
      familyOrder: family.order,
    });
  };

  for (const placement of slotsForDefinition(catalog, battlefleetDefinitionId)
    .filter((slot) => slot.kind === "Doctrine")
    .flatMap((slot) => directSlotOptionPlacements(catalog, slot)))
    add(placement, defaultFamily);

  const doctrineCategoryIds = new Set(
    Object.values(catalog.entities)
      .filter(
        (entity) =>
          entity.kind === "Category" && /fleet\s+doctrines?/iu.test(entity.label.plainText),
      )
      .map((entity) => entity.id),
  );
  const roots = Object.values(catalog.entities).filter(
    (entity) =>
      entity.kind === "Doctrine" ||
      (entity.kind === "Option" &&
        entity.provenance.documentRootId === battlefleet?.provenance.documentRootId &&
        (entity.categoryIds.some((id) => doctrineCategoryIds.has(id)) ||
          /fleet\s+doctrines?/iu.test(entity.label.plainText))),
  );
  const outgoing = new Map<string, Placement[]>();
  for (const placement of Object.values(catalog.placements)) {
    const placements = outgoing.get(placement.ownerId) ?? [];
    placements.push(placement);
    outgoing.set(placement.ownerId, placements);
  }
  const visit = (
    ownerId: string,
    family: { readonly id: string; readonly label: string; readonly order: number },
    visited: ReadonlySet<string>,
  ) => {
    if (visited.has(ownerId)) return;
    const nextVisited = new Set(visited).add(ownerId);
    for (const placement of (outgoing.get(ownerId) ?? []).sort(
      (left, right) => left.order - right.order || left.id.localeCompare(right.id),
    )) {
      const definition = placement.definitionId ? catalog.entities[placement.definitionId] : null;
      if (!definition || !["Option", "Doctrine", "OptionSlot"].includes(definition.kind)) continue;
      const nextFamily =
        definition.kind === "OptionSlot" && !/fleet\s+doctrines?/iu.test(definition.label.plainText)
          ? {
              id: normalizeDoctrineLabel(definition.label.plainText),
              label: definition.label.plainText,
              order: Number(definition.attributes.sortIndex ?? placement.order),
            }
          : family;
      add(placement, nextFamily);
      visit(definition.id, nextFamily, nextVisited);
    }
  };
  for (const root of roots) visit(root.id, defaultFamily, new Set());

  const visibleForFaction = raw.filter(
    (candidate) => !hiddenForPrimaryCatalogue(catalog, battlefleet, candidate),
  );
  const unique = new Map<string, FleetDoctrineCandidate>();
  for (const candidate of visibleForFaction) {
    const key = `${candidate.familyId}:${normalizeDoctrineLabel(candidate.definition.label.plainText)}`;
    const existing = unique.get(key);
    if (
      !existing ||
      doctrineCandidateRank(candidate, battlefleet) > doctrineCandidateRank(existing, battlefleet)
    )
      unique.set(key, candidate);
  }
  const deduplicated = [...unique.values()];
  const hasNamedFamilies = deduplicated.some((candidate) => candidate.familyId !== "fleet");
  const candidates = deduplicated
    .filter((candidate) => !hasNamedFamilies || candidate.familyId !== "fleet")
    .sort(
      (left, right) =>
        left.familyOrder - right.familyOrder ||
        left.placement.order - right.placement.order ||
        left.definition.label.plainText.localeCompare(right.definition.label.plainText),
    );
  return {
    candidates,
    rawCandidates: raw,
    multipleManufacturers: Boolean(
      battlefleet?.ruleIds.some(
        (id) => catalog.entities[id]?.label.plainText === "Multiple Manufacturers",
      ),
    ),
  };
}

function doctrineCandidateRank(
  candidate: FleetDoctrineCandidate,
  battlefleet: DomainEntity | undefined,
): number {
  const local =
    candidate.definition.provenance.documentRootId === battlefleet?.provenance.documentRootId;
  const visibleByDefault = candidate.definition.attributes.hidden !== "true";
  return (local ? 4 : 0) + (visibleByDefault ? 2 : 0) + (candidate.placement.resolved ? 1 : 0);
}

function hiddenForPrimaryCatalogue(
  catalog: DomainCatalog,
  battlefleet: DomainEntity | undefined,
  candidate: FleetDoctrineCandidate,
): boolean {
  if (!battlefleet) return false;
  const modifierIds = [
    ...candidate.definition.modifierIds,
    ...candidate.placement.overlay.modifierIds,
  ];
  return modifierIds.some((id) => {
    const modifier = catalog.entities[id];
    return Boolean(
      modifier?.kind === "Modifier" &&
      modifier.expression.field === "hidden" &&
      modifier.expression.value === "true" &&
      modifier.conditionIds.some((conditionId) =>
        conditionReferencesPrimaryCatalogue(
          catalog,
          conditionId,
          battlefleet.provenance.documentRootId,
          new Set(),
        ),
      ),
    );
  });
}

function conditionReferencesPrimaryCatalogue(
  catalog: DomainCatalog,
  conditionId: string,
  documentRootId: string,
  visited: Set<string>,
): boolean {
  if (visited.has(conditionId)) return false;
  visited.add(conditionId);
  const condition = catalog.entities[conditionId];
  if (!condition || (condition.kind !== "Condition" && condition.kind !== "ConditionGroup"))
    return false;
  if (
    condition.kind === "Condition" &&
    condition.expression.scope === "primary-catalogue" &&
    condition.expression.references.some(
      (id) => catalog.entities[id]?.provenance.documentRootId === documentRootId,
    )
  )
    return true;
  return condition.conditionIds.some((id) =>
    conditionReferencesPrimaryCatalogue(catalog, id, documentRootId, visited),
  );
}

function fleetDoctrineAvailability(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  owner: RosterSelectionInstance,
  candidate: FleetDoctrineCandidate,
): {
  readonly state: ShipEditorOptionReadModel["availability"];
  readonly reason: string | null;
} {
  const requirements = doctrineFlagshipRequirements(catalog, candidate);
  const hiddenByDefault =
    candidate.definition.attributes.hidden === "true" ||
    candidate.placement.overlay.attributes.hidden === "true";
  if (!requirements.length)
    return hiddenByDefault
      ? {
          state: "indeterminate",
          reason: "Каталог не содержит безопасно интерпретируемых условий этой доктрины.",
        }
      : { state: "available", reason: null };
  const flagships = fleetUnitCategoryLabels(snapshot, catalog, owner.id).filter((labels) =>
    labels.has("flagship"),
  );
  if (!flagships.length)
    return {
      state: "unavailable",
      reason: "Сначала добавьте подходящий флагман в Battlefleet.",
    };
  if (flagships.some((labels) => requirements.every((requirement) => labels.has(requirement.key))))
    return { state: "available", reason: null };
  return {
    state: "unavailable",
    reason: `Требуется флагман с признаками: ${requirements
      .filter((requirement) => requirement.key !== "flagship")
      .map((requirement) => requirement.label)
      .join(" · ")}.`,
  };
}

function doctrineFlagshipRequirements(
  catalog: DomainCatalog,
  candidate: FleetDoctrineCandidate,
): readonly { readonly key: string; readonly label: string }[] {
  const description = optionDescription(catalog, candidate.definition) ?? "";
  const phrase = /doctrine can only be purchased for an?\s+(.+?)\s+flagship unit/iu.exec(
    description,
  )?.[1];
  const normalizedPhrase = normalizeDoctrineLabel(phrase ?? "");
  const requirements = phrase
    ? Object.values(catalog.entities)
        .filter((entity) => {
          const label = normalizeDoctrineLabel(entity.label.plainText);
          return entity.kind === "Category" && label.length > 2 && normalizedPhrase.includes(label);
        })
        .map((entity) => ({
          key: normalizeDoctrineLabel(entity.label.plainText),
          label: entity.label.plainText,
        }))
    : [];
  const conditionIds = [
    ...candidate.definition.modifierIds,
    ...candidate.placement.overlay.modifierIds,
  ].flatMap((id) => {
    const modifier = catalog.entities[id];
    return modifier?.kind === "Modifier" &&
      modifier.expression.field === "hidden" &&
      modifier.expression.value === "false"
      ? modifier.conditionIds
      : [];
  });
  for (const conditionId of conditionIds) {
    for (const requirement of conditionCategoryRequirements(catalog, conditionId, new Set()))
      requirements.push(requirement);
  }
  if (phrase || requirements.some((requirement) => requirement.key === "flagship"))
    requirements.unshift({ key: "flagship", label: "Flagship" });
  return [...new Map(requirements.map((requirement) => [requirement.key, requirement])).values()];
}

function conditionCategoryRequirements(
  catalog: DomainCatalog,
  conditionId: string,
  visited: Set<string>,
): { readonly key: string; readonly label: string }[] {
  if (visited.has(conditionId)) return [];
  visited.add(conditionId);
  const condition = catalog.entities[conditionId];
  if (!condition || (condition.kind !== "Condition" && condition.kind !== "ConditionGroup"))
    return [];
  if (condition.kind === "Condition")
    return condition.expression.references.flatMap((id) => {
      const category = catalog.entities[id];
      return category?.kind === "Category"
        ? [
            {
              key: normalizeDoctrineLabel(category.label.plainText),
              label: category.label.plainText,
            },
          ]
        : [];
    });
  return condition.conditionIds.flatMap((id) =>
    conditionCategoryRequirements(catalog, id, visited),
  );
}

function fleetUnitCategoryLabels(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  forceInstanceId: string,
): readonly ReadonlySet<string>[] {
  const instances = Object.values(snapshot.instances);
  const children = new Map<string, RosterSelectionInstance[]>();
  for (const instance of instances) {
    if (!instance.parentInstanceId) continue;
    const entries = children.get(instance.parentInstanceId) ?? [];
    entries.push(instance);
    children.set(instance.parentInstanceId, entries);
  }
  const labelsFor = (root: RosterSelectionInstance): ReadonlySet<string> => {
    const labels = new Set<string>();
    const pending = [root];
    const visited = new Set<string>();
    while (pending.length) {
      const instance = pending.shift()!;
      if (visited.has(instance.id)) continue;
      visited.add(instance.id);
      const definition = catalog.entities[instance.definitionId];
      const placement = instance.placementId ? catalog.placements[instance.placementId] : null;
      for (const id of [
        ...(definition?.categoryIds ?? []),
        ...(placement?.overlay.categoryIds ?? []),
      ]) {
        const category = catalog.entities[id];
        if (category?.kind === "Category")
          labels.add(normalizeDoctrineLabel(category.label.plainText));
      }
      pending.push(...(children.get(instance.id) ?? []));
    }
    return labels;
  };
  return instances
    .filter(
      (instance) =>
        instance.forceInstanceId === forceInstanceId &&
        catalog.entities[instance.definitionId]?.kind === "Unit",
    )
    .map(labelsFor);
}

function normalizeDoctrineLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function resolveGroupContext(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  evaluation: RosterEvaluation,
  unit: RosterSelectionInstance,
  groupId: string,
): ShipEditorGroupContext | null {
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
    return { owner: model, slot, standalonePlacement: null };
  const standalone = standaloneOptionsForDefinition(catalog, unit.definitionId).find(
    (candidate) => candidate.slot.id === slot.id,
  );
  if (standalone) return { owner: unit, slot, standalonePlacement: standalone.placement };
  if (
    slotsForDefinition(catalog, unit.definitionId).some((candidate) => candidate.id === slot.id) &&
    isControllableSlot(evaluation, unit, slot)
  )
    return { owner: unit, slot, standalonePlacement: null };
  const fleet = unit.forceInstanceId ? snapshot.instances[unit.forceInstanceId] : null;
  if (
    fleet &&
    slotsForDefinition(catalog, fleet.definitionId).some((candidate) => candidate.id === slot.id) &&
    isControllableSlot(evaluation, fleet, slot)
  )
    return { owner: fleet, slot, standalonePlacement: null };
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

function standaloneOptionsForDefinition(
  catalog: DomainCatalog,
  definitionId: string,
): StandaloneOptionContext[] {
  const supportedKinds = new Set(["Weapon", "Option", "Generator", "Attachment", "Escort"]);
  return Object.values(catalog.placements)
    .filter(
      (placement) =>
        placement.ownerId === definitionId &&
        placement.slotId === null &&
        placement.resolved &&
        !placement.ambiguous &&
        placement.overlay.attributes.hidden !== "true" &&
        optionalPlacementCardinality(placement) !== null,
    )
    .flatMap((placement) => {
      const definition = placement.definitionId ? catalog.entities[placement.definitionId] : null;
      if (!definition || !supportedKinds.has(definition.kind)) return [];
      const slot = definition.slotIds
        .map((id) => catalog.slots[id])
        .find((candidate): candidate is Slot =>
          Boolean(
            candidate &&
            !candidate.hidden &&
            !candidate.helper &&
            candidate.optionPlacementIds.length === 0,
          ),
        );
      return slot ? [{ slot, placement }] : [];
    })
    .sort(
      (left, right) =>
        left.placement.order - right.placement.order ||
        left.placement.id.localeCompare(right.placement.id),
    );
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
    const placement = directSlotOptionPlacements(catalog, slot)
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

export function directSlotOptionPlacements(catalog: DomainCatalog, slot: Slot): Placement[] {
  return slot.optionPlacementIds
    .map((id) => catalog.placements[id])
    .filter((placement): placement is Placement =>
      Boolean(
        placement?.definitionId &&
        placement.slotId === slot.id &&
        placement.ownerId === slot.ownerId,
      ),
    );
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

function optionalPlacementCardinality(
  placement: Placement,
): { readonly minimum: number; readonly maximum: number } | null {
  const source = placement.overlay.cardinality;
  if (!source) return null;
  const minimum = source.minimum.state === "missing" ? 0 : amountNumber(source.minimum);
  const maximum = amountNumber(source.maximum);
  return minimum === null || maximum === null || minimum < 0 || maximum < minimum
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
  const structuralModelPlacement =
    definition?.kind === "Unit" ? editorModelPlacement(catalog, definition.id) : null;
  const structuralModel = structuralModelPlacement?.definitionId
    ? catalog.entities[structuralModelPlacement.definitionId]
    : null;
  const ids = new Set([
    ...(definition?.costIds ?? []),
    ...(placement?.overlay.costIds ?? []),
    ...(structuralModel?.costIds ?? []),
    ...(structuralModelPlacement?.overlay.costIds ?? []),
  ]);
  const points = [...ids].reduce((sum, id) => {
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

function availabilityReason(reasonCodes: readonly string[]): string {
  const messages = reasonCodes.map((code) => {
    switch (code) {
      case "SLOT_MAX_REACHED":
        return "Достигнут лимит этой группы.";
      case "PLACEMENT_CONSTRAINT":
        return "Не подходит для выбранного корабля или Battlefleet.";
      case "CONDITION_NOT_MET":
        return "Не выполнены условия этой опции.";
      case "SLOT_HIDDEN":
      case "OPTION_HIDDEN":
        return "Опция недоступна в текущем составе.";
      case "HELPER_SLOT":
        return "Это служебная настройка каталога.";
      default:
        return "Каталог не позволяет выбрать эту опцию.";
    }
  });
  return [...new Set(messages)].join(" ") || "Недостаточно данных каталога.";
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
