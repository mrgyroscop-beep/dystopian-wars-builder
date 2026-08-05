import { z } from "zod";

import { rosterInstanceId, type RosterSelectionInstance } from "../../domain/roster";
import { storedRosterSchema, type RosterRepository, type StoredRoster } from "./create-roster";

export interface RosterLibraryRepository extends RosterRepository {
  list(): Promise<readonly StoredRoster[]>;
  remove(id: string): Promise<void>;
}

export interface RosterLibraryDependencies {
  readonly rosterRepository: RosterLibraryRepository;
  readonly createId: () => string;
  readonly now: () => string;
}

const exportDocumentSchema = z
  .object({
    format: z.literal("dystopian-wars-builder-roster"),
    version: z.literal(1),
    roster: storedRosterSchema,
  })
  .strict();

export async function deleteRoster(
  roster: StoredRoster,
  dependencies: Pick<RosterLibraryDependencies, "rosterRepository">,
): Promise<void> {
  await dependencies.rosterRepository.remove(roster.id);
}

export async function renameRoster(
  roster: StoredRoster,
  name: string,
  dependencies: RosterLibraryDependencies,
): Promise<StoredRoster> {
  const normalized = name.trim();
  if (!normalized || normalized.length > 80)
    throw new Error("Введите название от 1 до 80 символов.");
  const updated = { ...roster, name: normalized, updatedAt: dependencies.now() };
  await dependencies.rosterRepository.save(updated);
  return updated;
}

export async function duplicateRoster(
  roster: StoredRoster,
  dependencies: RosterLibraryDependencies,
  suffix = "копия",
): Promise<StoredRoster> {
  const copy = cloneRoster(roster, dependencies, `${roster.name} (${suffix})`);
  await dependencies.rosterRepository.save(copy);
  return copy;
}

export function exportRoster(roster: StoredRoster): string {
  return JSON.stringify({ format: "dystopian-wars-builder-roster", version: 1, roster }, null, 2);
}

export async function importRoster(
  source: string,
  dependencies: RosterLibraryDependencies,
): Promise<StoredRoster> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(source);
  } catch {
    throw new Error("Файл не является корректным JSON.");
  }
  const parsed = exportDocumentSchema.safeParse(candidate);
  if (!parsed.success) throw new Error("Формат файла не поддерживается или повреждён.");
  const imported = cloneRoster(
    parsed.data.roster as unknown as StoredRoster,
    dependencies,
    `${parsed.data.roster.name} (импорт)`,
  );
  await dependencies.rosterRepository.save(imported);
  return imported;
}

function cloneRoster(
  source: StoredRoster,
  dependencies: Pick<RosterLibraryDependencies, "createId" | "now">,
  name: string,
): StoredRoster {
  const id = safeRosterId(dependencies.createId());
  const idMap = new Map<string, string>();
  for (const previousId of Object.keys(source.roster.instances)) {
    idMap.set(previousId, safeInstanceId(dependencies.createId()));
  }
  const instances: Record<string, RosterSelectionInstance> = {};
  for (const instance of Object.values(source.roster.instances)) {
    const nextId = idMap.get(instance.id)!;
    instances[nextId] = {
      ...instance,
      id: rosterInstanceId(nextId),
      parentInstanceId: instance.parentInstanceId
        ? rosterInstanceId(idMap.get(instance.parentInstanceId)!)
        : null,
      forceInstanceId: instance.forceInstanceId
        ? rosterInstanceId(idMap.get(instance.forceInstanceId)!)
        : null,
    };
  }
  const timestamp = dependencies.now();
  const cloned: StoredRoster = {
    ...source,
    id,
    name: name.slice(0, 80),
    roster: {
      ...source.roster,
      id,
      rootInstanceIds: source.roster.rootInstanceIds.map((rootId) =>
        rosterInstanceId(idMap.get(rootId)!),
      ),
      instances,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const parsed = storedRosterSchema.safeParse(cloned);
  if (!parsed.success) throw new Error("Флот содержит несовместимые данные.");
  return parsed.data as unknown as StoredRoster;
}

function safeRosterId(value: string): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/u.test(value))
    throw new Error("Не удалось создать безопасный ID флота.");
  return value;
}

function safeInstanceId(value: string): string {
  if (!value || value.length > 240) throw new Error("Не удалось создать безопасный ID элемента.");
  return value;
}
