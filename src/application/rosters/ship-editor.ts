import type { DomainCatalog, EntityId } from "../../domain/catalog";
import {
  evaluateRoster,
  rosterInstanceId,
  type RosterInstanceId,
  type RosterSelectionInstance,
  type RosterSnapshot,
} from "../../domain/roster";

export const AKITA_DEMONSTRATOR_ID = "demo-ship-001";
export const AKITA_MODEL_ID = "demo-akita-model";
export const AKITA_ESCORT_DISCOUNT_ID = "demo-akita-escort-discount";

export type ShipEditorGroupId = "psa" | "fps-1" | "fps-2" | "fps-3" | "attachments" | "escorts";

export interface ShipEditorOptionReadModel {
  readonly id: string;
  readonly label: string;
  readonly kind: "Weapon" | "Generator" | "Attachment" | "Escort";
  readonly costLabel: string;
  readonly selectedQuantity: number;
  readonly availability: "available" | "unavailable" | "indeterminate";
  readonly reason: string | null;
}

export interface ShipEditorGroupReadModel {
  readonly id: ShipEditorGroupId;
  readonly label: string;
  readonly help: string;
  readonly control: "exclusive" | "quantity";
  readonly minimum: number;
  readonly maximum: number;
  readonly options: readonly ShipEditorOptionReadModel[];
}

export interface ShipEditorProblemReadModel {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly targetGroupId: ShipEditorGroupId;
}

export interface ShipEditorReadModel {
  readonly mode: "preview" | "instance";
  readonly instanceId: string | null;
  readonly name: string;
  readonly basePoints: string;
  readonly optionPoints: string;
  readonly derivedPoints: string;
  readonly totalPoints: string;
  readonly victoryPoints: string;
  readonly mandatory: { readonly selected: number; readonly required: 4 };
  readonly validity: "valid" | "invalid" | "indeterminate";
  readonly persistence: "saved-local" | "unsaved" | "saving" | "save-error";
  readonly system: "ready" | "unavailable";
  readonly groups: readonly ShipEditorGroupReadModel[];
  readonly problems: readonly ShipEditorProblemReadModel[];
  readonly breakdown: readonly { readonly label: string; readonly value: string }[];
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

interface OptionDefinition {
  readonly id: string;
  readonly label: string;
  readonly kind: ShipEditorOptionReadModel["kind"];
  readonly points: number;
  readonly availability?: "unavailable" | "indeterminate";
  readonly reason?: string;
}

interface GroupDefinition {
  readonly id: ShipEditorGroupId;
  readonly label: string;
  readonly help: string;
  readonly control: "exclusive" | "quantity";
  readonly minimum: number;
  readonly maximum: number;
  readonly options: readonly OptionDefinition[];
}

export const AKITA_GROUPS: readonly GroupDefinition[] = [
  {
    id: "psa",
    label: "PSA",
    help: "Основная система вооружения — выберите ровно один вариант.",
    control: "exclusive",
    minimum: 1,
    maximum: 1,
    options: [
      { id: "demo-akita-magma-cast", label: "Magma Cast", kind: "Weapon", points: 0 },
      { id: "demo-akita-heavy-battery", label: "Heavy Battery", kind: "Weapon", points: 15 },
      {
        id: "demo-akita-sealed-array",
        label: "Sealed Experimental Array",
        kind: "Weapon",
        points: 25,
        availability: "unavailable",
        reason: "Недоступно для учебной доктрины Harbour Patrol.",
      },
    ],
  },
  {
    id: "fps-1",
    label: "FPS 1",
    help: "Передняя система — Weapon или Generator, ровно один вариант.",
    control: "exclusive",
    minimum: 1,
    maximum: 1,
    options: [
      {
        id: "demo-akita-kagutsuchi",
        label: "Kagutsuchi Generator",
        kind: "Generator",
        points: 20,
      },
      { id: "demo-akita-fury-generator", label: "Fury Generator", kind: "Generator", points: 0 },
    ],
  },
  {
    id: "fps-2",
    label: "FPS 2",
    help: "Бортовая система — выберите ровно один вариант.",
    control: "exclusive",
    minimum: 1,
    maximum: 1,
    options: [
      { id: "demo-akita-rocket-battery", label: "Rocket Battery", kind: "Weapon", points: 10 },
      { id: "demo-akita-flak-battery", label: "Flak Battery", kind: "Weapon", points: 0 },
    ],
  },
  {
    id: "fps-3",
    label: "FPS 3",
    help: "Кормовая система — выберите ровно один вариант.",
    control: "exclusive",
    minimum: 1,
    maximum: 1,
    options: [
      {
        id: "demo-akita-shield-generator",
        label: "Shield Generator",
        kind: "Generator",
        points: 10,
      },
      { id: "demo-akita-mine-layer", label: "Mine Layer", kind: "Weapon", points: 0 },
    ],
  },
  {
    id: "attachments",
    label: "Attachments",
    help: "Дополнительный модуль: от 0 до 1.",
    control: "quantity",
    minimum: 0,
    maximum: 1,
    options: [
      { id: "demo-akita-repair-crane", label: "Repair Crane", kind: "Attachment", points: 5 },
    ],
  },
  {
    id: "escorts",
    label: "Escorts",
    help: "Эскортные корабли: от 0 до 4.",
    control: "quantity",
    minimum: 0,
    maximum: 4,
    options: [
      { id: "demo-akita-tanuki-escort", label: "Tanuki Escort", kind: "Escort", points: 10 },
    ],
  },
] as const;

export function isShipEditorDefinition(definitionId: string): boolean {
  return definitionId === AKITA_DEMONSTRATOR_ID;
}

export function materializeShipStructure(
  snapshot: RosterSnapshot,
  unit: RosterSelectionInstance,
  createId: () => string,
): RosterSnapshot {
  if (!isShipEditorDefinition(unit.definitionId)) return snapshot;
  if (
    Object.values(snapshot.instances).some(
      (candidate) =>
        candidate.parentInstanceId === unit.id && candidate.definitionId === AKITA_MODEL_ID,
    )
  )
    return snapshot;
  const id = freshId(snapshot.instances, createId);
  return {
    ...snapshot,
    instances: {
      ...snapshot.instances,
      [id]: selection(id, AKITA_MODEL_ID, unit.id, unit.forceInstanceId ?? unit.id, 1),
    },
  };
}

export function applyShipEditorCommand(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  command: ShipEditorCommand,
  createId: () => string,
): RosterSnapshot {
  const unit = snapshot.instances[command.instanceId];
  if (!unit || !isShipEditorDefinition(unit.definitionId))
    throw new ShipEditorCommandError("UNKNOWN_INSTANCE", "Редактируемый корабль не найден.");
  const group = AKITA_GROUPS.find((candidate) => candidate.id === command.groupId);
  if (!group) throw new ShipEditorCommandError("UNKNOWN_GROUP", "Группа конфигурации не найдена.");
  const option = group.options.find((candidate) => candidate.id === command.optionId);
  if (!option || !catalog.entities[option.id])
    throw new ShipEditorCommandError("UNKNOWN_OPTION", "Опция конфигурации не найдена.");
  if (option.availability === "unavailable")
    throw new ShipEditorCommandError("UNAVAILABLE", option.reason ?? "Опция недоступна.");
  if (option.availability === "indeterminate")
    throw new ShipEditorCommandError(
      "INDETERMINATE",
      option.reason ?? "Доступность опции неизвестна.",
    );
  if (command.type === "replace-exclusive" && group.control !== "exclusive")
    throw new ShipEditorCommandError("UNKNOWN_GROUP", "Группа не поддерживает замену выбора.");
  if (command.type === "set-choice-quantity" && group.control !== "quantity")
    throw new ShipEditorCommandError("UNKNOWN_GROUP", "Группа не поддерживает количество.");
  const quantity = command.type === "replace-exclusive" ? 1 : command.quantity;
  if (!Number.isSafeInteger(quantity) || quantity < group.minimum || quantity > group.maximum)
    throw new ShipEditorCommandError(
      "OUT_OF_RANGE",
      `Допустимое количество для ${group.label}: ${group.minimum}–${group.maximum}.`,
    );

  const groupOptionIds = new Set(group.options.map((candidate) => candidate.id));
  const instances = { ...snapshot.instances };
  for (const candidate of Object.values(instances)) {
    if (candidate.parentInstanceId !== unit.id || !groupOptionIds.has(candidate.definitionId))
      continue;
    delete instances[candidate.id];
  }
  if (quantity > 0) {
    const id = freshId(instances, createId);
    instances[id] = selection(id, option.id, unit.id, unit.forceInstanceId ?? unit.id, quantity);
  }
  synchronizeDerivedDiscount(instances, unit, createId);
  const candidate = { ...snapshot, instances };
  // Unknown catalogue references and malformed derived instances block before persistence.
  const evaluation = evaluateRoster(catalog, candidate);
  if (evaluation.status === "indeterminate")
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
  persistence: ShipEditorReadModel["persistence"],
): ShipEditorReadModel | null {
  const unit = instanceId ? snapshot.instances[instanceId] : null;
  const mode = unit ? "instance" : "preview";
  if (unit && !isShipEditorDefinition(unit.definitionId)) return null;
  if (!catalog.entities[AKITA_DEMONSTRATOR_ID]) return null;
  const children = unit
    ? Object.values(snapshot.instances).filter(
        (candidate) => candidate.parentInstanceId === unit.id,
      )
    : [];
  const selectedQuantity = (optionId: string) =>
    children
      .filter((candidate) => candidate.definitionId === optionId)
      .reduce((sum, candidate) => sum + candidate.quantity, 0);
  const groups = AKITA_GROUPS.map((group): ShipEditorGroupReadModel => ({
    ...group,
    options: group.options.map((option) => ({
      id: option.id,
      label: option.label,
      kind: option.kind,
      costLabel: option.points === 0 ? "Бесплатно" : `+${option.points} Points`,
      selectedQuantity: selectedQuantity(option.id),
      availability: option.availability ?? "available",
      reason: option.reason ?? null,
    })),
  }));
  const mandatory = groups
    .filter((group) => group.control === "exclusive")
    .filter((group) => group.options.some((option) => option.selectedQuantity === 1)).length;
  const kagutsuchi = selectedQuantity("demo-akita-kagutsuchi") > 0;
  const magma = selectedQuantity("demo-akita-magma-cast") > 0;
  const problems: ShipEditorProblemReadModel[] = [];
  for (const group of groups.filter((candidate) => candidate.control === "exclusive"))
    if (!group.options.some((option) => option.selectedQuantity === 1))
      problems.push({
        id: `required-${group.id}`,
        title: `${group.label}: требуется выбор`,
        detail: "Выберите ровно одну систему.",
        targetGroupId: group.id,
      });
  if (kagutsuchi && !magma)
    problems.push({
      id: "kagutsuchi-requires-magma",
      title: "Kagutsuchi требует Magma Cast",
      detail:
        "Перейдите к PSA и выберите Magma Cast; редактор не применяет зависимость автоматически.",
      targetGroupId: "psa",
    });
  const optionPoints = AKITA_GROUPS.flatMap((group) => group.options).reduce(
    (sum, option) => sum + option.points * selectedQuantity(option.id),
    0,
  );
  const derivedPoints = selectedQuantity("demo-akita-tanuki-escort") === 4 ? -10 : 0;
  return {
    mode,
    instanceId: unit?.id ?? null,
    name: "Akita Demonstrator",
    basePoints: "350",
    optionPoints: String(optionPoints),
    derivedPoints: String(derivedPoints),
    totalPoints: String(350 + optionPoints + derivedPoints),
    victoryPoints: "9",
    mandatory: { selected: mandatory, required: 4 },
    validity: problems.length ? "invalid" : "valid",
    persistence,
    system: "ready",
    groups,
    problems,
    breakdown: [
      { label: "Базовая стоимость", value: "350" },
      { label: "Выбранные опции", value: signed(optionPoints) },
      ...(derivedPoints
        ? [{ label: "Скрытая скидка Escort 4/4", value: signed(derivedPoints) }]
        : []),
    ],
  };
}

function synchronizeDerivedDiscount(
  instances: Record<string, RosterSelectionInstance>,
  unit: RosterSelectionInstance,
  createId: () => string,
): void {
  const derived = Object.values(instances).filter(
    (candidate) =>
      candidate.parentInstanceId === unit.id && candidate.definitionId === AKITA_ESCORT_DISCOUNT_ID,
  );
  const escorts = Object.values(instances)
    .filter(
      (candidate) =>
        candidate.parentInstanceId === unit.id &&
        candidate.definitionId === "demo-akita-tanuki-escort",
    )
    .reduce((sum, candidate) => sum + candidate.quantity, 0);
  if (escorts === 4 && derived.length === 0) {
    const id = freshId(instances, createId);
    instances[id] = selection(
      id,
      AKITA_ESCORT_DISCOUNT_ID,
      unit.id,
      unit.forceInstanceId ?? unit.id,
      1,
    );
  } else if (escorts !== 4) {
    for (const candidate of derived) delete instances[candidate.id];
  }
}

function selection(
  id: RosterInstanceId,
  definitionId: string,
  parentInstanceId: RosterInstanceId,
  forceInstanceId: RosterInstanceId,
  quantity: number,
): RosterSelectionInstance {
  return {
    contractVersion: 1,
    id,
    definitionId: definitionId as EntityId,
    placementId: null,
    slotId: null,
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
