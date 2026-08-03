import { z } from "zod";

import type { DomainCatalog, EntityId } from "../../domain/catalog";
import { rosterSnapshotSchema, type RosterSnapshot } from "../../domain/roster";

export interface RequiredFleetElement {
  readonly id: string;
  readonly label: string;
  readonly minimum: number;
}

export interface BattlefleetSetupOption {
  readonly id: string;
  readonly factionId: string;
  readonly label: string;
  readonly summary: string;
  readonly requiredElements: readonly RequiredFleetElement[];
}

export interface FactionSetupOption {
  readonly id: string;
  readonly label: string;
  readonly battlefleets: readonly BattlefleetSetupOption[];
}

export interface RosterSetupCatalog {
  readonly contractVersion: 1;
  readonly contentVersion: string;
  readonly mode: "current" | "demonstration";
  readonly notice: string | null;
  readonly factions: readonly FactionSetupOption[];
}

export interface RosterSetupGateway {
  readonly contractVersion: 1;
  load(contentVersion?: string): Promise<RosterSetupCatalog>;
}

export const rosterSetupCatalogSchema = z.object({
  contractVersion: z.literal(1),
  contentVersion: z.string().min(1),
  mode: z.enum(["current", "demonstration"]),
  notice: z.string().nullable(),
  factions: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      battlefleets: z.array(
        z.object({
          id: z.string().min(1),
          factionId: z.string().min(1),
          label: z.string().min(1),
          summary: z.string(),
          requiredElements: z.array(
            z.object({
              id: z.string().min(1),
              label: z.string().min(1),
              minimum: z.number().int().min(0),
            }),
          ),
        }),
      ),
    }),
  ),
});

export const storedRosterSchema = z.object({
  contractVersion: z.literal(1),
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/u),
  name: z.string().trim().min(1).max(80),
  faction: z.object({ id: z.string().min(1), label: z.string().min(1) }),
  battlefleet: z.object({ id: z.string().min(1), label: z.string().min(1) }),
  limits: z.object({
    points: z.number().int().min(1).max(100_000),
    victoryPoints: z.number().int().min(0).max(10_000),
  }),
  requiredElements: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      minimum: z.number().int().min(0),
    }),
  ),
  roster: rosterSnapshotSchema,
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export interface StoredRoster {
  readonly contractVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly faction: { readonly id: string; readonly label: string };
  readonly battlefleet: { readonly id: string; readonly label: string };
  readonly limits: { readonly points: number; readonly victoryPoints: number };
  readonly requiredElements: readonly RequiredFleetElement[];
  readonly roster: RosterSnapshot;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RosterRepository {
  readonly contractVersion: 1;
  save(roster: StoredRoster): Promise<void>;
  read(id: string): Promise<StoredRoster | null>;
}

export interface CreateRosterInput {
  readonly name: string;
  readonly factionId: string;
  readonly battlefleetId: string;
  readonly pointsLimit: string;
  readonly victoryPointsLimit: string;
}

export type CreateRosterField = keyof CreateRosterInput;
export type CreateRosterErrors = Partial<Record<CreateRosterField, string>>;

export interface CreateRosterDependencies {
  readonly setupGateway: RosterSetupGateway;
  readonly rosterRepository: RosterRepository;
  readonly createId: () => string;
  readonly now: () => string;
}

export class CreateRosterValidationError extends Error {
  constructor(readonly fields: CreateRosterErrors) {
    super("Roster creation input is invalid");
    this.name = "CreateRosterValidationError";
  }
}

export async function createRoster(
  input: CreateRosterInput,
  dependencies: CreateRosterDependencies,
): Promise<StoredRoster> {
  const setup = await dependencies.setupGateway.load();
  const errors = validateCreateRosterInput(input, setup);
  if (Object.keys(errors).length > 0) throw new CreateRosterValidationError(errors);

  const faction = setup.factions.find((candidate) => candidate.id === input.factionId)!;
  const battlefleet = faction.battlefleets.find(
    (candidate) => candidate.id === input.battlefleetId,
  )!;
  const id = dependencies.createId();
  if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(id))
    throw new Error("Roster ID factory returned an unsafe ID");
  const timestamp = dependencies.now();
  const rosterSnapshot: RosterSnapshot = {
    contractVersion: 1,
    id,
    catalogContentVersion: setup.contentVersion,
    rootInstanceIds: [],
    instances: {},
  };
  const roster: StoredRoster = {
    contractVersion: 1,
    id,
    name: input.name.trim(),
    faction: { id: faction.id, label: faction.label },
    battlefleet: { id: battlefleet.id, label: battlefleet.label },
    limits: {
      points: Number(input.pointsLimit),
      victoryPoints: Number(input.victoryPointsLimit),
    },
    requiredElements: battlefleet.requiredElements.map((element) => ({ ...element })),
    roster: rosterSnapshot,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const parsed = storedRosterSchema.safeParse(roster);
  if (!parsed.success) throw new Error("Created roster failed its persistence contract");
  await dependencies.rosterRepository.save(roster);
  return roster;
}

export function validateCreateRosterInput(
  input: CreateRosterInput,
  setup: RosterSetupCatalog,
): CreateRosterErrors {
  const errors: CreateRosterErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = "Введите название флота.";
  else if (name.length > 80) errors.name = "Название должно быть не длиннее 80 символов.";

  const faction = setup.factions.find((candidate) => candidate.id === input.factionId);
  if (!faction) errors.factionId = "Выберите фракцию.";
  if (!faction?.battlefleets.some((candidate) => candidate.id === input.battlefleetId))
    errors.battlefleetId = "Выберите доступный Battlefleet.";

  if (!isIntegerInRange(input.pointsLimit, 1, 100_000))
    errors.pointsLimit = "Укажите лимит Points от 1 до 100 000.";
  if (!isIntegerInRange(input.victoryPointsLimit, 0, 10_000))
    errors.victoryPointsLimit = "Укажите лимит VP от 0 до 10 000.";
  return errors;
}

export function projectRosterSetup(catalog: DomainCatalog): RosterSetupCatalog {
  const entities = Object.values(catalog.entities);
  const factions = entities
    .filter((entity) => entity.kind === "Faction")
    .map((faction) => {
      const battlefleets = entities
        .filter(
          (entity) =>
            entity.kind === "Battlefleet" &&
            entity.provenance.documentPath === faction.provenance.documentPath,
        )
        .map((battlefleet): BattlefleetSetupOption => ({
          id: battlefleet.id,
          factionId: faction.id,
          label: battlefleet.label.plainText,
          summary: conciseSummary(
            battlefleet.description?.plainText ||
              battlefleet.fields.map((field) => field.value.plainText).find(Boolean) ||
              "Особенности Battlefleet будут применены к составу.",
          ),
          requiredElements: requiredElements(catalog, battlefleet.id),
        }))
        .sort(compareLabels);
      return { id: faction.id, label: faction.label.plainText, battlefleets };
    })
    .filter((faction) => faction.battlefleets.length > 0)
    .sort(compareLabels);
  return {
    contractVersion: 1,
    contentVersion: catalog.contentVersion,
    mode: "current",
    notice: null,
    factions,
  };
}

function requiredElements(
  catalog: DomainCatalog,
  battlefleetId: EntityId,
): readonly RequiredFleetElement[] {
  const elements: RequiredFleetElement[] = [];
  for (const placement of Object.values(catalog.placements)) {
    if (placement.ownerId !== battlefleetId || !placement.resolved || !placement.definitionId)
      continue;
    const entity = catalog.entities[placement.definitionId];
    if (entity?.kind !== "BattlefleetElement") continue;
    const constraintIds = [...entity.constraintIds, ...placement.overlay.constraintIds];
    const minimum = constraintIds.reduce((highest, id) => {
      const constraint = catalog.entities[id];
      if (
        constraint?.kind !== "Constraint" ||
        constraint.expression.operator !== "min" ||
        constraint.expression.field !== "selections" ||
        !constraint.expression.evaluable
      )
        return highest;
      const value = Number(constraint.expression.value);
      return Number.isSafeInteger(value) && value > highest ? value : highest;
    }, 0);
    const hasShips = Object.values(catalog.placements).some((candidate) => {
      if (candidate.ownerId !== entity.id || !candidate.definitionId || !candidate.resolved)
        return false;
      const definition = catalog.entities[candidate.definitionId];
      return definition?.kind === "Unit" || definition?.kind === "Model";
    });
    if (!hasShips && minimum === 0) continue;
    elements.push({ id: entity.id, label: entity.label.plainText, minimum });
  }
  return elements.sort(compareLabels);
}

function conciseSummary(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length <= 280 ? normalized : `${normalized.slice(0, 277).trimEnd()}…`;
}

function compareLabels(
  left: { readonly label: string },
  right: { readonly label: string },
): number {
  return left.label.localeCompare(right.label, "en");
}

function isIntegerInRange(value: string, minimum: number, maximum: number): boolean {
  if (!/^\d+$/u.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum;
}
