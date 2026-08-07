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
  const placements = fleetDoctrinePlacements(catalog, owner.definitionId);
  const options = placements.flatMap((placement) => {
    const definition = placement.definitionId ? catalog.entities[placement.definitionId] : null;
    if (!definition) return [];
    const selected = Object.values(snapshot.instances).some(
      (instance) =>
        instance.definitionId === definition.id && instance.forceInstanceId === owner.id,
    );
    return [
      {
        id: definition.id,
        label: definition.label.plainText,
        kind: definition.kind,
        costLabel: optionCostLabel(catalog, definition, placement),
        selectedQuantity: selected ? 1 : 0,
        availability: "available" as const,
        reason: null,
        description: optionDescription(catalog, definition),
      },
    ];
  });
  if (!options.length) return null;
  return {
    ownerInstanceId: owner.id,
    groups: [
      {
        id: `fleet-doctrine:${owner.definitionId}`,
        label: "Доктрина флота",
        help: "Выберите одну доктрину для всего Battlefleet.",
        scope: "fleet",
        control: "exclusive",
        minimum: 0,
        maximum: 1,
        options,
      },
    ],
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
  const option = fleetDoctrinePlacements(catalog, owner.definitionId).find(
    (placement) => placement.definitionId === command.optionId,
  );
  if (!option?.definitionId)
    throw new ShipEditorCommandError("UNKNOWN_OPTION", "Доктрина недоступна для этого флота.");
  const doctrineIds = new Set(
    fleetDoctrinePlacements(catalog, owner.definitionId).flatMap((placement) =>
      placement.definitionId ? [placement.definitionId] : [],
    ),
  );
  const instances = { ...snapshot.instances };
  for (const instance of Object.values(instances)) {
    if (instance.forceInstanceId === owner.id && doctrineIds.has(instance.definitionId))
      delete instances[instance.id];
  }
  const id = freshId(instances, createId);
  instances[id] = selection(id, option.definitionId, null, null, owner.id, owner.id, 1);
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
        bounds.minimum === 1 &&
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

function fleetDoctrinePlacements(
  catalog: DomainCatalog,
  battlefleetDefinitionId: string,
): Placement[] {
  const direct = slotsForDefinition(catalog, battlefleetDefinitionId)
    .filter((slot) => slot.kind === "Doctrine")
    .flatMap((slot) => directSlotOptionPlacements(catalog, slot));
  const doctrineCategoryIds = new Set(
    Object.values(catalog.entities)
      .filter(
        (entity) =>
          entity.kind === "Category" && /fleet\s+doctrines?/iu.test(entity.label.plainText),
      )
      .map((entity) => entity.id),
  );
  const containerIds = new Set(
    Object.values(catalog.entities)
      .filter(
        (entity) =>
          entity.kind === "Doctrine" ||
          (entity.kind === "Option" &&
            (entity.categoryIds.some((id) => doctrineCategoryIds.has(id)) ||
              /fleet\s+doctrines?/iu.test(entity.label.plainText))),
      )
      .map((entity) => entity.id),
  );
  const categorized = Object.values(catalog.placements).filter((placement) => {
    if (!containerIds.has(placement.ownerId) || !placement.definitionId) return false;
    const definition = catalog.entities[placement.definitionId];
    return Boolean(
      definition &&
      ["Option", "Doctrine"].includes(definition.kind) &&
      !/fleet\s+doctrines?/iu.test(definition.label.plainText) &&
      (definition.ruleIds.length > 0 || definition.description?.plainText.trim()),
    );
  });
  const unique = new Map<string, Placement>();
  for (const placement of [...direct, ...categorized].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id),
  )) {
    if (placement.definitionId && !unique.has(placement.definitionId))
      unique.set(placement.definitionId, placement);
  }
  return [...unique.values()];
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
  const ids = [
    ...(definition?.costIds ?? []),
    ...(placement?.overlay.costIds ?? []),
    ...(structuralModel?.costIds ?? []),
    ...(structuralModelPlacement?.overlay.costIds ?? []),
  ];
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
