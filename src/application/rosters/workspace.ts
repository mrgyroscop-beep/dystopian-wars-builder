import type { DomainCatalog, DomainEntity, EntityId, PlacementId } from "../../domain/catalog";
import {
  evaluateRoster,
  rosterInstanceId,
  type RosterEvaluation,
  type RosterInstanceId,
  type RosterSelectionInstance,
  type RosterSnapshot,
} from "../../domain/roster";

import type {
  BattlefleetSetupOption,
  RosterRepository,
  RosterSetupCatalog,
  RosterSetupGateway,
  StoredRoster,
} from "./create-roster";
import {
  applyShipEditorCommand,
  directSlotOptionPlacements,
  isShipEditorDefinition,
  materializeShipStructure,
  projectShipEditor,
  type ShipEditorCommand,
  type ShipEditorReadModel,
} from "./ship-editor";

export const fleetCategories = [
  "Flagship",
  "Line",
  "Patrol",
  "Support",
  "Scout",
  "Logistical",
  "Другое",
] as const;

export type FleetCategory = (typeof fleetCategories)[number];
export type AvailabilityState = "available" | "unavailable" | "indeterminate";
export type PersistenceState = "saved-local" | "unsaved" | "saving" | "save-error";
export type ValidityState = "valid" | "warning" | "invalid" | "unavailable";

export interface CatalogTargetReadModel {
  readonly elementInstanceId: string;
  readonly elementLabel: string;
  readonly placementId: string;
}

export interface CatalogItemReadModel {
  readonly id: string;
  readonly name: string;
  readonly category: FleetCategory;
  readonly role: string;
  readonly nation: string;
  readonly platform: string;
  readonly points: string;
  readonly victoryPoints: string;
  readonly preview: string;
  readonly availability: {
    readonly state: AvailabilityState;
    readonly reason: string | null;
  };
  readonly eligibleTargets: readonly CatalogTargetReadModel[];
}

export interface RosterInstanceReadModel {
  readonly id: string;
  readonly definitionId: string;
  readonly name: string;
  readonly points: string;
  readonly victoryPoints: string;
}

export interface FleetElementReadModel {
  readonly id: string;
  readonly definitionId: string;
  readonly label: string;
  readonly minimum: number;
  readonly instances: readonly RosterInstanceReadModel[];
}

export interface WorkspaceProblemReadModel {
  readonly id: string;
  readonly code: string;
  readonly severity: "error" | "warning";
  readonly title: string;
  readonly locationLabel: string;
  readonly reason: string;
  readonly guidance: string;
  readonly targetId: string;
  readonly dedupeKey: string;
}

export interface RosterWorkspaceReadModel {
  readonly roster: {
    readonly id: string;
    readonly name: string;
    readonly faction: string;
    readonly battlefleetId: string;
    readonly battlefleet: string;
    readonly battlefleets: readonly {
      readonly id: string;
      readonly label: string;
      readonly summary: string;
      readonly compatibleShipCount: number;
      readonly removedShipCount: number;
    }[];
  };
  readonly summary: {
    readonly points: string;
    readonly pointsLimit: number;
    readonly victoryPoints: string;
    readonly victoryPointsLimit: number;
    readonly validity: ValidityState;
    readonly validityLabel: string;
    readonly errorCount: number;
    readonly warningCount: number;
    readonly persistence: PersistenceState;
    readonly persistenceLabel: string;
    readonly availability: "ready" | "degraded" | "unavailable";
    readonly availabilityLabel: string;
  };
  readonly catalog: readonly CatalogItemReadModel[];
  readonly elements: readonly FleetElementReadModel[];
  readonly problems: readonly WorkspaceProblemReadModel[];
}

export type RosterWorkspaceCommand =
  | {
      readonly type: "add";
      readonly definitionId: string;
      readonly targetElementInstanceId?: string;
    }
  | { readonly type: "duplicate"; readonly instanceId: string }
  | { readonly type: "delete"; readonly instanceId: string }
  | { readonly type: "change-battlefleet"; readonly battlefleetId: string }
  | ShipEditorCommand;

export interface RosterCatalogGateway {
  readonly contractVersion: 1;
  load(contentVersion: string, factionId?: string): Promise<DomainCatalog>;
}

export interface RosterWorkspaceDependencies {
  readonly catalogGateway: RosterCatalogGateway;
  readonly setupGateway: RosterSetupGateway;
  readonly rosterRepository: RosterRepository;
  readonly createId: () => string;
  readonly now: () => string;
  readonly fallbackRoster?: (id: string) => StoredRoster | null;
}

export interface RosterWorkspaceSession {
  readonly model: RosterWorkspaceReadModel;
  editor(instanceId: string | null, definitionId: string | null): ShipEditorReadModel | null;
  execute(command: RosterWorkspaceCommand): Promise<RosterWorkspaceReadModel>;
  executeDetailed(command: RosterWorkspaceCommand): Promise<RosterWorkspaceExecution>;
  retrySave(): Promise<RosterWorkspaceReadModel>;
}

export interface RosterWorkspaceExecution {
  readonly model: RosterWorkspaceReadModel;
  readonly createdInstanceId: string | null;
  readonly battlefleetChange: {
    readonly preservedShipCount: number;
    readonly removedShipCount: number;
  } | null;
}

export class WorkspaceCommandError extends Error {
  constructor(
    readonly code:
      | "UNAVAILABLE"
      | "TARGET_REQUIRED"
      | "UNKNOWN_TARGET"
      | "UNKNOWN_INSTANCE"
      | "UNKNOWN_BATTLEFLEET",
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceCommandError";
  }
}

export async function openRosterWorkspace(
  id: string,
  dependencies: RosterWorkspaceDependencies,
): Promise<RosterWorkspaceSession | null> {
  const stored =
    (await dependencies.rosterRepository.read(id)) ?? dependencies.fallbackRoster?.(id);
  if (!stored) return null;
  const [catalog, setup] = await Promise.all([
    dependencies.catalogGateway.load(stored.roster.catalogContentVersion, stored.faction.id),
    dependencies.setupGateway.load(stored.roster.catalogContentVersion),
  ]);
  const session = new WorkspaceSession(stored, catalog, setup, dependencies);
  await session.prepare();
  return session;
}

export function filterCatalogItems(
  items: readonly CatalogItemReadModel[],
  query: string,
  category: FleetCategory | "all",
): readonly CatalogItemReadModel[] {
  const normalized = query.normalize("NFC").trim().toLocaleLowerCase("ru");
  return items.filter((item) => {
    if (category !== "all" && item.category !== category) return false;
    if (!normalized) return true;
    return [item.name, item.role, item.nation, item.platform, item.category]
      .join(" ")
      .toLocaleLowerCase("ru")
      .includes(normalized);
  });
}

class WorkspaceSession implements RosterWorkspaceSession {
  private current: StoredRoster;
  private persistence: PersistenceState = "saved-local";
  private currentModel: RosterWorkspaceReadModel;

  constructor(
    stored: StoredRoster,
    private readonly catalog: DomainCatalog,
    private readonly setup: RosterSetupCatalog,
    private readonly dependencies: RosterWorkspaceDependencies,
  ) {
    this.current = stored;
    this.currentModel = projectWorkspace(stored, catalog, setup, this.persistence);
  }

  get model(): RosterWorkspaceReadModel {
    return this.currentModel;
  }

  editor(instanceId: string | null, definitionId: string | null): ShipEditorReadModel | null {
    const targetDefinitionId = instanceId
      ? this.current.roster.instances[instanceId]?.definitionId
      : definitionId;
    if (!targetDefinitionId || !isShipEditorDefinition(this.catalog, targetDefinitionId))
      return null;
    return projectShipEditor(
      this.current.roster,
      this.catalog,
      instanceId,
      definitionId,
      this.persistence,
    );
  }

  async prepare(): Promise<void> {
    const prepared = ensureRosterStructure(this.current, this.catalog);
    if (prepared === this.current) return;
    await this.persist(prepared);
  }

  async execute(command: RosterWorkspaceCommand): Promise<RosterWorkspaceReadModel> {
    return (await this.executeDetailed(command)).model;
  }

  async executeDetailed(command: RosterWorkspaceCommand): Promise<RosterWorkspaceExecution> {
    if (command.type === "change-battlefleet") {
      const battlefleet = battlefleetsFor(this.current, this.setup).find(
        (candidate) => candidate.id === command.battlefleetId,
      );
      if (!battlefleet)
        throw new WorkspaceCommandError(
          "UNKNOWN_BATTLEFLEET",
          "Battlefleet недоступен для выбранной фракции.",
        );
      const changed = changeBattlefleet(
        this.current,
        this.catalog,
        battlefleet,
        this.dependencies.createId,
      );
      const candidate = { ...changed.roster, updatedAt: this.dependencies.now() };
      return {
        model: await this.persist(candidate),
        createdInstanceId: null,
        battlefleetChange: {
          preservedShipCount: changed.preservedShipCount,
          removedShipCount: changed.removedShipCount,
        },
      };
    }
    const result = applyCommand(this.current, this.catalog, command, this.dependencies.createId);
    const candidate: StoredRoster = {
      ...this.current,
      roster: result.snapshot,
      updatedAt: this.dependencies.now(),
    };
    return {
      model: await this.persist(candidate),
      createdInstanceId: result.createdInstanceId,
      battlefleetChange: null,
    };
  }

  async retrySave(): Promise<RosterWorkspaceReadModel> {
    this.persistence = "saving";
    this.currentModel = projectWorkspace(this.current, this.catalog, this.setup, this.persistence);
    try {
      await this.dependencies.rosterRepository.save(this.current);
      this.persistence = "saved-local";
    } catch {
      this.persistence = "save-error";
    }
    this.currentModel = projectWorkspace(this.current, this.catalog, this.setup, this.persistence);
    return this.currentModel;
  }

  private async persist(candidate: StoredRoster): Promise<RosterWorkspaceReadModel> {
    // The candidate is evaluated before persistence. A failed save never discards it.
    projectWorkspace(candidate, this.catalog, this.setup, "unsaved");
    this.current = candidate;
    this.persistence = "saving";
    this.currentModel = projectWorkspace(candidate, this.catalog, this.setup, this.persistence);
    try {
      await this.dependencies.rosterRepository.save(candidate);
      this.persistence = "saved-local";
    } catch {
      this.persistence = "save-error";
    }
    this.currentModel = projectWorkspace(candidate, this.catalog, this.setup, this.persistence);
    return this.currentModel;
  }
}

function ensureRosterStructure(stored: StoredRoster, catalog: DomainCatalog): StoredRoster {
  const snapshot = stored.roster;
  const battlefleet = catalog.entities[stored.battlefleet.id];
  if (!battlefleet || battlefleet.kind !== "Battlefleet") return stored;

  const instances = { ...snapshot.instances };
  let changed = false;
  for (const [id, instance] of Object.entries(instances)) {
    if (!instance.placementId || !instance.slotId) continue;
    const placement = catalog.placements[instance.placementId];
    const slot = catalog.slots[instance.slotId];
    if (!placement || !slot || placement.ownerId === slot.ownerId) continue;
    const replacement = directSlotOptionPlacements(catalog, slot).find(
      (candidate) => candidate.definitionId === placement.ownerId,
    );
    if (!replacement?.definitionId) continue;
    instances[id] = {
      ...instance,
      definitionId: replacement.definitionId,
      placementId: replacement.id,
    };
    changed = true;
  }
  let root = Object.values(instances).find(
    (instance) => instance.definitionId === battlefleet.id && instance.parentInstanceId === null,
  );
  if (!root) {
    const id = rosterInstanceId(`structure-${safeId(snapshot.id)}-battlefleet`);
    root = selection(id, battlefleet.id, null, null, id);
    instances[id] = root;
    changed = true;
  }

  for (const required of stored.requiredElements) {
    const definition = catalog.entities[required.id];
    if (!definition || definition.kind !== "BattlefleetElement") continue;
    const exists = Object.values(instances).some(
      (instance) =>
        instance.definitionId === definition.id && instance.parentInstanceId === root.id,
    );
    if (exists) continue;
    const id = rosterInstanceId(`structure-${safeId(snapshot.id)}-${safeId(required.id)}`);
    const placement = Object.values(catalog.placements).find(
      (candidate) =>
        candidate.ownerId === battlefleet.id && candidate.definitionId === definition.id,
    );
    instances[id] = selection(id, definition.id, placement?.id ?? null, root.id, root.id);
    changed = true;
  }

  if (!changed) return stored;
  const roster: RosterSnapshot = {
    ...snapshot,
    rootInstanceIds: Object.values(instances)
      .filter((instance) => instance.parentInstanceId === null)
      .map((instance) => instance.id)
      .sort(),
    instances,
  };
  return { ...stored, roster };
}

function battlefleetsFor(
  stored: StoredRoster,
  setup: RosterSetupCatalog,
): readonly BattlefleetSetupOption[] {
  const options =
    setup.contentVersion === stored.roster.catalogContentVersion
      ? setup.factions.find((candidate) => candidate.id === stored.faction.id)?.battlefleets
      : null;
  if (options?.length) return options;
  return [
    {
      id: stored.battlefleet.id,
      factionId: stored.faction.id,
      label: stored.battlefleet.label,
      summary: "Текущий Battlefleet сохранён в составе.",
      requiredElements: stored.requiredElements,
    },
  ];
}

function changeBattlefleet(
  stored: StoredRoster,
  catalog: DomainCatalog,
  battlefleet: BattlefleetSetupOption,
  createId: () => string,
): {
  readonly roster: StoredRoster;
  readonly preservedShipCount: number;
  readonly removedShipCount: number;
} {
  if (battlefleet.id === stored.battlefleet.id)
    return {
      roster: stored,
      preservedShipCount: shipRoots(stored, catalog).length,
      removedShipCount: 0,
    };

  const previousInstances = stored.roster.instances;
  const reserved = { ...previousInstances };
  const instances: Record<string, RosterSelectionInstance> = {};
  const rootId = freshInstanceId({ ...reserved, ...instances }, createId);
  instances[rootId] = selection(rootId, battlefleet.id as EntityId, null, null, rootId);

  const elementInstances = new Map<string, RosterSelectionInstance>();
  for (const required of battlefleet.requiredElements) {
    const placement = Object.values(catalog.placements)
      .filter(
        (candidate) =>
          candidate.ownerId === battlefleet.id && candidate.definitionId === required.id,
      )
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))[0];
    if (!placement) continue;
    const id = freshInstanceId({ ...reserved, ...instances }, createId);
    const element = selection(id, required.id as EntityId, placement.id, rootId, rootId);
    instances[id] = element;
    elementInstances.set(required.id, element);
  }

  let preservedShipCount = 0;
  let removedShipCount = 0;
  for (const ship of shipRoots(stored, catalog)) {
    const previousParent = ship.parentInstanceId ? previousInstances[ship.parentInstanceId] : null;
    const placements = Object.values(catalog.placements)
      .filter(
        (candidate) =>
          candidate.definitionId === ship.definitionId &&
          candidate.resolved &&
          !candidate.ambiguous &&
          elementInstances.has(candidate.ownerId),
      )
      .sort((left, right) => {
        const leftKeepsElement = left.ownerId === previousParent?.definitionId ? 0 : 1;
        const rightKeepsElement = right.ownerId === previousParent?.definitionId ? 0 : 1;
        return (
          leftKeepsElement - rightKeepsElement ||
          left.order - right.order ||
          left.id.localeCompare(right.id)
        );
      });
    const placement = placements[0];
    const parent = placement ? elementInstances.get(placement.ownerId) : null;
    if (!placement || !parent) {
      removedShipCount += 1;
      continue;
    }
    const subtree = descendantsIncluding(stored.roster, ship.id);
    for (const id of subtree) {
      const original = previousInstances[id];
      if (!original) continue;
      instances[id] =
        original.id === ship.id
          ? {
              ...original,
              placementId: placement.id,
              parentInstanceId: parent.id,
              forceInstanceId: rootId,
            }
          : { ...original, forceInstanceId: rootId };
    }
    preservedShipCount += 1;
  }

  const snapshot: RosterSnapshot = {
    ...stored.roster,
    rootInstanceIds: [rootId],
    instances,
  };
  return {
    roster: {
      ...stored,
      battlefleet: { id: battlefleet.id, label: battlefleet.label },
      requiredElements: battlefleet.requiredElements.map((element) => ({ ...element })),
      roster: snapshot,
    },
    preservedShipCount,
    removedShipCount,
  };
}

function shipRoots(stored: StoredRoster, catalog: DomainCatalog): RosterSelectionInstance[] {
  return Object.values(stored.roster.instances)
    .filter((instance) => {
      const parent = instance.parentInstanceId
        ? stored.roster.instances[instance.parentInstanceId]
        : null;
      return (
        ["Unit", "Model"].includes(catalog.entities[instance.definitionId]?.kind ?? "") &&
        catalog.entities[parent?.definitionId ?? ""]?.kind === "BattlefleetElement"
      );
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function compatibleShipCount(
  stored: StoredRoster,
  catalog: DomainCatalog,
  battlefleet: BattlefleetSetupOption,
): number {
  const elementIds = new Set(battlefleet.requiredElements.map((element) => element.id));
  return shipRoots(stored, catalog).filter((ship) =>
    Object.values(catalog.placements).some(
      (placement) =>
        placement.definitionId === ship.definitionId &&
        placement.resolved &&
        !placement.ambiguous &&
        elementIds.has(placement.ownerId),
    ),
  ).length;
}

function applyCommand(
  stored: StoredRoster,
  catalog: DomainCatalog,
  command: RosterWorkspaceCommand,
  createId: () => string,
): { readonly snapshot: RosterSnapshot; readonly createdInstanceId: RosterInstanceId | null } {
  const snapshot = stored.roster;
  if (command.type === "change-battlefleet")
    throw new WorkspaceCommandError(
      "UNKNOWN_BATTLEFLEET",
      "Смена Battlefleet должна выполняться на уровне рабочей сессии.",
    );
  if (
    command.type === "replace-exclusive" ||
    command.type === "set-choice-quantity" ||
    command.type === "set-model-quantity"
  )
    return {
      snapshot: applyShipEditorCommand(snapshot, catalog, command, createId),
      createdInstanceId: null,
    };
  const instances = { ...snapshot.instances };
  let addedId: RosterInstanceId | null = null;
  if (command.type === "add") {
    const projected = projectCatalog(catalog, stored);
    const item = projected.find((candidate) => candidate.id === command.definitionId);
    if (!item || item.availability.state !== "available")
      throw new WorkspaceCommandError(
        "UNAVAILABLE",
        item?.availability.reason ?? "Корабль недоступен для этого состава.",
      );
    if (item.eligibleTargets.length > 1 && !command.targetElementInstanceId)
      throw new WorkspaceCommandError("TARGET_REQUIRED", "Выберите Battlefleet Element.");
    const target = command.targetElementInstanceId
      ? item.eligibleTargets.find(
          (candidate) => candidate.elementInstanceId === command.targetElementInstanceId,
        )
      : item.eligibleTargets[0];
    if (!target) throw new WorkspaceCommandError("UNKNOWN_TARGET", "Выбранный Element недоступен.");
    const parent = instances[target.elementInstanceId];
    if (!parent)
      throw new WorkspaceCommandError("UNKNOWN_TARGET", "Battlefleet Element не найден.");
    const root = rootOf(parent, instances);
    const id = freshInstanceId(instances, createId);
    addedId = id;
    instances[id] = selection(
      id,
      item.id as EntityId,
      target.placementId as PlacementId,
      parent.id,
      root.id,
    );
  } else {
    const current = instances[command.instanceId];
    if (!current || !["Unit", "Model"].includes(catalog.entities[current.definitionId]?.kind ?? ""))
      throw new WorkspaceCommandError("UNKNOWN_INSTANCE", "Корабль не найден в составе.");
    if (command.type === "duplicate") {
      duplicateSubtree(current, instances, createId);
    } else {
      const removed = new Set<string>([current.id]);
      let size = -1;
      while (size !== removed.size) {
        size = removed.size;
        for (const candidate of Object.values(instances))
          if (candidate.parentInstanceId && removed.has(candidate.parentInstanceId))
            removed.add(candidate.id);
      }
      for (const id of removed) delete instances[id];
    }
  }
  const next = { ...snapshot, instances };
  return {
    snapshot: addedId
      ? materializeShipStructure(next, catalog, instances[addedId]!, createId)
      : next,
    createdInstanceId: addedId,
  };
}

function duplicateSubtree(
  root: RosterSelectionInstance,
  instances: Record<string, RosterSelectionInstance>,
  createId: () => string,
): void {
  const subtree: RosterSelectionInstance[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift()!;
    subtree.push(current);
    pending.push(
      ...Object.values(instances)
        .filter((candidate) => candidate.parentInstanceId === current.id)
        .sort((left, right) => left.id.localeCompare(right.id)),
    );
  }
  const replacementIds = new Map<string, RosterInstanceId>();
  for (const original of subtree)
    replacementIds.set(original.id, freshInstanceId(instances, createId));
  for (const original of subtree) {
    const id = replacementIds.get(original.id)!;
    instances[id] = {
      ...original,
      id,
      parentInstanceId:
        original.id === root.id
          ? root.parentInstanceId
          : (replacementIds.get(original.parentInstanceId ?? "") ?? original.parentInstanceId),
    };
  }
}

function projectWorkspace(
  stored: StoredRoster,
  catalog: DomainCatalog,
  setup: RosterSetupCatalog,
  persistence: PersistenceState,
): RosterWorkspaceReadModel {
  const evaluation = evaluateRoster(catalog, stored.roster);
  const elements = projectElements(stored, catalog, evaluation);
  const problems = projectProblems(stored, catalog, evaluation, elements);
  const points = totalFor(evaluation, "points");
  const victoryPoints = totalFor(evaluation, "victory-points");
  if (Number(points) > stored.limits.points)
    problems.push(limitProblem("POINTS_LIMIT_EXCEEDED", "Points", points, stored.limits.points));
  if (Number(victoryPoints) > stored.limits.victoryPoints)
    problems.push(
      limitProblem("VP_LIMIT_EXCEEDED", "VP", victoryPoints, stored.limits.victoryPoints),
    );
  const catalogItems = projectCatalog(catalog, stored);
  const availability = catalogItems.some((item) => item.availability.state === "available")
    ? catalogItems.some((item) => item.availability.state !== "available")
      ? "degraded"
      : "ready"
    : "unavailable";
  const errorCount = problems.filter((problem) => problem.severity === "error").length;
  const warningCount = problems.filter((problem) => problem.severity === "warning").length;
  const totalShipCount = shipRoots(stored, catalog).length;
  const battlefleets = battlefleetsFor(stored, setup).map((battlefleet) => {
    const compatible = compatibleShipCount(stored, catalog, battlefleet);
    return {
      id: battlefleet.id,
      label: battlefleet.label,
      summary: battlefleet.summary,
      compatibleShipCount: compatible,
      removedShipCount: totalShipCount - compatible,
    };
  });
  const validity: ValidityState =
    evaluation.status === "indeterminate"
      ? "unavailable"
      : errorCount > 0
        ? "invalid"
        : warningCount > 0
          ? "warning"
          : "valid";
  return {
    roster: {
      id: stored.id,
      name: stored.name,
      faction: stored.faction.label,
      battlefleetId: stored.battlefleet.id,
      battlefleet: stored.battlefleet.label,
      battlefleets,
    },
    summary: {
      points,
      pointsLimit: stored.limits.points,
      victoryPoints,
      victoryPointsLimit: stored.limits.victoryPoints,
      validity,
      validityLabel:
        validity === "valid"
          ? "Готов к игре"
          : validity === "warning"
            ? `Предупреждений: ${warningCount}`
            : validity === "unavailable"
              ? "Проверка недоступна"
              : `Нужно исправить: ${errorCount}`,
      errorCount,
      warningCount,
      persistence,
      persistenceLabel: persistenceLabel(persistence),
      availability,
      availabilityLabel:
        availability === "ready"
          ? "Каталог доступен"
          : availability === "degraded"
            ? "Каталог частично доступен"
            : "Каталог недоступен",
    },
    catalog: catalogItems,
    elements,
    problems: problems.sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function projectCatalog(
  catalog: DomainCatalog,
  stored: StoredRoster,
): readonly CatalogItemReadModel[] {
  const demonstration = Object.values(catalog.entities).some((entity) =>
    Object.keys(entity.attributes).some((key) => key.startsWith("demo.")),
  );
  const elementInstances = Object.values(stored.roster.instances).filter(
    (instance) => catalog.entities[instance.definitionId]?.kind === "BattlefleetElement",
  );
  const items = Object.values(catalog.entities)
    .filter(
      (entity) =>
        (entity.kind === "Unit" || entity.kind === "Model") &&
        entity.attributes["demo.catalog"] !== "hidden",
    )
    .map((entity): CatalogItemReadModel => {
      const targets = Object.values(catalog.placements)
        .filter(
          (placement) =>
            placement.definitionId === entity.id &&
            placement.resolved &&
            !placement.ambiguous &&
            elementInstances.some((instance) => instance.definitionId === placement.ownerId),
        )
        .flatMap((placement) => {
          const instance = elementInstances.find(
            (candidate) => candidate.definitionId === placement.ownerId,
          );
          if (!instance) return [];
          return [
            {
              elementInstanceId: instance.id,
              elementLabel: catalog.entities[instance.definitionId]?.label.plainText || "Element",
              placementId: placement.id,
            },
          ];
        })
        .sort((left, right) => left.elementLabel.localeCompare(right.elementLabel, "ru"));
      const declared = entity.attributes["demo.availability"];
      const state: AvailabilityState =
        declared === "indeterminate"
          ? "indeterminate"
          : declared === "unavailable" || targets.length === 0
            ? "unavailable"
            : "available";
      const reason =
        state === "indeterminate"
          ? entity.attributes["demo.availabilityReason"] ||
            "Недостаточно данных, чтобы безопасно определить доступность."
          : state === "unavailable"
            ? entity.attributes["demo.availabilityReason"] ||
              "Нет подходящего Battlefleet Element для этого корабля."
            : null;
      return {
        id: entity.id,
        name: entity.label.plainText || entity.labels.fallbackLabel,
        category: categoryFor(entity, catalog),
        role: entity.attributes.role || "Корабль",
        nation: entity.attributes.nation || stored.faction.label,
        platform: entity.attributes.platform || "Surface",
        points: entityCost(entity, targets[0]?.placementId, catalog, "points"),
        victoryPoints: entityCost(entity, targets[0]?.placementId, catalog, "victory-points"),
        preview:
          entity.description?.plainText ||
          "Безопасная демонстрационная карточка без upstream-изображений и игровых данных.",
        availability: { state, reason },
        eligibleTargets: targets,
      };
    })
    .filter(
      (item) =>
        demonstration ||
        item.eligibleTargets.length > 0 ||
        item.availability.state === "indeterminate",
    );
  const rank = new Map(fleetCategories.map((category, index) => [category, index]));
  return items.sort(
    (left, right) =>
      (rank.get(left.category) ?? 99) - (rank.get(right.category) ?? 99) ||
      left.name.localeCompare(right.name, "ru") ||
      left.id.localeCompare(right.id),
  );
}

function projectElements(
  stored: StoredRoster,
  catalog: DomainCatalog,
  evaluation: RosterEvaluation,
): FleetElementReadModel[] {
  return Object.values(stored.roster.instances)
    .filter((instance) => catalog.entities[instance.definitionId]?.kind === "BattlefleetElement")
    .map((element) => {
      const requirement = stored.requiredElements.find(
        (candidate) => candidate.id === element.definitionId,
      );
      const children = Object.values(stored.roster.instances)
        .filter((instance) => instance.parentInstanceId === element.id)
        .map((instance): RosterInstanceReadModel => ({
          id: instance.id,
          definitionId: instance.definitionId,
          name: catalog.entities[instance.definitionId]?.label.plainText || "Неизвестный корабль",
          points: contributionFor(stored.roster, evaluation, instance.id, "points"),
          victoryPoints: contributionFor(stored.roster, evaluation, instance.id, "victory-points"),
        }))
        .sort(
          (left, right) =>
            left.name.localeCompare(right.name, "ru") || left.id.localeCompare(right.id),
        );
      return {
        id: element.id,
        definitionId: element.definitionId,
        label:
          catalog.entities[element.definitionId]?.label.plainText ||
          requirement?.label ||
          "Element",
        minimum: requirement?.minimum ?? 0,
        instances: children,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label, "ru"));
}

function projectProblems(
  stored: StoredRoster,
  catalog: DomainCatalog,
  evaluation: RosterEvaluation,
  elements: readonly FleetElementReadModel[],
): WorkspaceProblemReadModel[] {
  const problems: WorkspaceProblemReadModel[] = evaluation.problems.map((problem) => {
    const targetId = problem.target.instanceId
      ? `roster-instance-${safeId(problem.target.instanceId)}`
      : "workspace-summary";
    return {
      id: problem.id,
      code: problem.code,
      severity: problem.severity === "warning" ? "warning" : "error",
      title: problem.severity === "indeterminate" ? "Проверка не завершена" : "Ошибка состава",
      locationLabel: problem.target.instanceId ? "Состав" : stored.name,
      reason: translatedProblemReason(problem.code, problem.actual, problem.expected),
      guidance: problem.target.instanceId
        ? "Откройте отмеченный объект и проверьте его размещение."
        : "Повторите проверку после обновления каталога.",
      targetId,
      dedupeKey: `evaluator:${problem.code}:${targetId}:roster`,
    };
  });
  for (const element of elements) {
    const definition = catalog.entities[element.definitionId];
    const evaluatorOwnsMinimum = definition?.constraintIds.some((id) => {
      const constraint = catalog.entities[id];
      return (
        constraint?.kind === "Constraint" &&
        constraint.expression.field === "selections" &&
        constraint.expression.operator === "min" &&
        constraint.expression.evaluable
      );
    });
    if (evaluatorOwnsMinimum) continue;
    if (element.instances.length >= element.minimum) continue;
    problems.push({
      id: `required:${element.id}`,
      code: "REQUIRED_ELEMENT_EMPTY",
      severity: "error",
      title: "Battlefleet Element не заполнен",
      locationLabel: element.label,
      reason: `Добавлено ${element.instances.length} из ${element.minimum}.`,
      guidance: "Выберите доступный корабль в каталоге и добавьте его в этот Element.",
      targetId: `fleet-element-${safeId(element.id)}`,
      dedupeKey: `workspace:REQUIRED_ELEMENT_EMPTY:${element.id}:element`,
    });
  }
  return problems;
}

function limitProblem(
  code: string,
  label: string,
  actual: string,
  limit: number,
): WorkspaceProblemReadModel {
  return {
    id: code,
    code,
    severity: "error",
    title: `Превышен лимит ${label}`,
    locationLabel: "Сводка флота",
    reason: `${actual} из ${limit}.`,
    guidance: "Удалите или замените корабли, чтобы вернуться в лимит.",
    targetId: "workspace-summary",
    dedupeKey: `workspace:${code}:roster:summary`,
  };
}

function selection(
  id: RosterInstanceId,
  definitionId: EntityId,
  placementId: PlacementId | null,
  parentInstanceId: RosterInstanceId | null,
  forceInstanceId: RosterInstanceId,
): RosterSelectionInstance {
  return {
    contractVersion: 1,
    id,
    definitionId,
    placementId,
    slotId: null,
    parentInstanceId,
    forceInstanceId,
    quantity: 1,
  };
}

function rootOf(
  instance: RosterSelectionInstance,
  instances: Readonly<Record<string, RosterSelectionInstance>>,
): RosterSelectionInstance {
  let current = instance;
  const visited = new Set<string>();
  while (current.parentInstanceId) {
    if (visited.has(current.id)) break;
    visited.add(current.id);
    const parent = instances[current.parentInstanceId];
    if (!parent) break;
    current = parent;
  }
  return current;
}

function freshInstanceId(
  instances: Readonly<Record<string, RosterSelectionInstance>>,
  createId: () => string,
): RosterInstanceId {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const candidate = createId();
    if (candidate && !instances[candidate]) return rosterInstanceId(candidate);
  }
  throw new Error("Instance ID factory did not return a unique ID");
}

function categoryFor(entity: DomainEntity, catalog: DomainCatalog): FleetCategory {
  const source = [
    entity.attributes.category,
    ...entity.categoryIds.map((id) => catalog.entities[id]?.label.plainText ?? ""),
  ]
    .join(" ")
    .toLocaleLowerCase("en");
  if (source.includes("flagship")) return "Flagship";
  if (source.includes("line")) return "Line";
  if (source.includes("patrol")) return "Patrol";
  if (source.includes("support")) return "Support";
  if (source.includes("scout")) return "Scout";
  if (source.includes("logistic")) return "Logistical";
  return "Другое";
}

function entityCost(
  entity: DomainEntity,
  incomingPlacementId: string | undefined,
  catalog: DomainCatalog,
  resource: "points" | "victory-points",
): string {
  const incoming = incomingPlacementId ? catalog.placements[incomingPlacementId] : undefined;
  let total = costTotal(
    [...entity.costIds, ...(incoming?.overlay.costIds ?? [])],
    catalog,
    resource,
  );
  const modelPlacement = Object.values(catalog.placements)
    .filter(
      (placement) =>
        placement.ownerId === entity.id &&
        placement.definitionId &&
        catalog.entities[placement.definitionId]?.kind === "Model",
    )
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))[0];
  if (modelPlacement?.definitionId) {
    const model = catalog.entities[modelPlacement.definitionId];
    const minimum = cardinalityNumber(modelPlacement.overlay.cardinality?.minimum) ?? 1;
    total +=
      minimum *
      costTotal([...(model?.costIds ?? []), ...modelPlacement.overlay.costIds], catalog, resource);
  }
  return String(Number.isInteger(total) ? total : Number(total.toFixed(6)));
}

function costTotal(
  ids: readonly string[],
  catalog: DomainCatalog,
  resource: "points" | "victory-points",
): number {
  const values = ids.flatMap((id) => {
    const cost = catalog.entities[id];
    if (cost?.kind !== "Cost" || cost.semantics.resource !== resource) return [];
    return cost.amount.state === "zero"
      ? [0]
      : cost.amount.state === "value"
        ? [Number(cost.amount.value)]
        : [];
  });
  return values.reduce((sum, value) => sum + value, 0);
}

function cardinalityNumber(
  value: { readonly state: string; readonly value?: string } | undefined,
): number | null {
  if (!value) return null;
  if (value.state === "zero") return 0;
  if (value.state !== "value" || value.value === undefined) return null;
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function totalFor(evaluation: RosterEvaluation, resource: "points" | "victory-points"): string {
  return decimalSum(
    evaluation.totals.filter((total) => total.resource === resource).map((total) => total.value),
  );
}

function contributionFor(
  snapshot: RosterSnapshot,
  evaluation: RosterEvaluation,
  instanceId: string,
  resource: "points" | "victory-points",
): string {
  const descendants = descendantsIncluding(snapshot, instanceId);
  return decimalSum(
    evaluation.contributions
      .filter(
        (contribution) =>
          descendants.has(contribution.instanceId) && contribution.resource === resource,
      )
      .map((contribution) => contribution.value),
  );
}

function descendantsIncluding(snapshot: RosterSnapshot, rootId: string): Set<string> {
  const result = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const current = pending.shift()!;
    if (result.has(current)) continue;
    result.add(current);
    for (const instance of Object.values(snapshot.instances))
      if (instance.parentInstanceId === current) pending.push(instance.id);
  }
  return result;
}

function decimalSum(values: readonly string[]): string {
  const total = values.reduce((sum, value) => sum + Number(value), 0);
  return Number.isInteger(total) ? String(total) : String(Number(total.toFixed(6)));
}

function persistenceLabel(state: PersistenceState): string {
  if (state === "saved-local") return "Сохранено на устройстве";
  if (state === "saving") return "Сохранение…";
  if (state === "save-error") return "Не сохранено · повторить";
  return "Есть несохранённые изменения";
}

function translatedProblemReason(
  code: string,
  actual: string | null,
  expected: string | null,
): string {
  const values = actual && expected ? ` Сейчас: ${actual}; требуется: ${expected}.` : "";
  const known: Record<string, string> = {
    CATALOG_VERSION_MISMATCH: "Версия состава не совпадает с версией каталога.",
    UNKNOWN_DEFINITION: "Сохранённый объект отсутствует в текущем каталоге.",
    UNKNOWN_PARENT: "Не найден родительский объект состава.",
    UNKNOWN_PLACEMENT: "Не найдено размещение корабля в Battlefleet Element.",
    CONSTRAINT_MIN_NOT_MET: "Не выполнен обязательный минимум.",
    CONSTRAINT_MAX_EXCEEDED: "Превышено допустимое количество.",
  };
  return `${known[code] ?? "Состав нельзя безопасно проверить по текущему каталогу."}${values}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "-");
}
