import { z } from "zod";

import { storedRosterSchema, type StoredRoster } from "../../application/rosters/create-roster";
import type { RosterLibraryRepository } from "../../application/rosters/roster-library";
import type { RosterSyncGateway, RosterSyncResult } from "../../application/rosters/roster-sync";

const metaKey = "dwb.sync.v1.meta";
const queueKey = "dwb.sync.v1.queue";
const localRosterKeyPrefix = "dwb.roster.v1.";
const syncItemSchema = z.object({
  version: z.number().int().positive(),
  roster: z.custom<StoredRoster>((value) => storedRosterSchema.safeParse(value).success),
});
const syncListSchema = z.object({ rosters: z.array(syncItemSchema) });
const conflictSchema = z.object({ current: syncItemSchema.nullable() });
const metaSchema = z.record(
  z.string(),
  z.object({
    version: z.number().int().positive(),
    updatedAt: z.string().datetime({ offset: true }),
  }),
);
const queueSchema = z.array(z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u));

export function createSynchronizingRosterRepository(
  local: RosterLibraryRepository,
  storage: Storage,
  fetcher: typeof fetch = fetch,
): RosterSyncGateway {
  let timer: number | undefined;

  async function save(roster: StoredRoster): Promise<void> {
    await local.save(roster);
    const queue = readQueue(storage);
    if (!queue.includes(roster.id)) writeQueue(storage, [...queue, roster.id]);
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => void synchronize(), 700);
  }

  async function synchronize(): Promise<RosterSyncResult> {
    const stats = { uploaded: 0, downloaded: 0, conflicts: 0, authenticated: true };
    const meta = readMeta(storage);
    const queued = [...readQueue(storage)];
    for (const id of queued) {
      const roster = await local.read(id);
      if (!roster) {
        removeQueued(storage, id);
        continue;
      }
      const response = await fetcher(`/api/rosters/${encodeURIComponent(id)}`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roster, expectedVersion: meta[id]?.version ?? 0 }),
      }).catch(() => null);
      if (!response) return { ...stats, authenticated: true };
      if (response.status === 401) return { ...stats, authenticated: false };
      if (response.status === 409) {
        const payload = conflictSchema.parse(await response.json());
        const conflictCopy = createConflictCopy(roster);
        await local.save(conflictCopy);
        const nextQueue = readQueue(storage).filter((item) => item !== id);
        writeQueue(storage, [...nextQueue, conflictCopy.id]);
        if (payload.current) {
          const remote = payload.current.roster;
          await local.save(remote);
          meta[id] = { version: payload.current.version, updatedAt: remote.updatedAt };
        } else {
          storage.removeItem(`${localRosterKeyPrefix}${id}`);
          delete meta[id];
        }
        writeMeta(storage, meta);
        stats.conflicts += 1;
        continue;
      }
      if (!response.ok) return stats;
      const uploaded = syncItemSchema.parse(await response.json());
      meta[id] = { version: uploaded.version, updatedAt: roster.updatedAt };
      writeMeta(storage, meta);
      removeQueued(storage, id);
      stats.uploaded += 1;
    }

    const response = await fetcher("/api/rosters", { credentials: "same-origin" }).catch(
      () => null,
    );
    if (!response) {
      writeMeta(storage, meta);
      return stats;
    }
    if (response.status === 401) return { ...stats, authenticated: false };
    if (!response.ok) return stats;
    const remote = syncListSchema.parse(await response.json());
    const stillQueued = new Set(readQueue(storage));
    for (const item of remote.rosters) {
      if (stillQueued.has(item.roster.id)) continue;
      const roster = item.roster;
      const known = meta[roster.id];
      if (!known || known.version < item.version || !(await local.read(roster.id))) {
        await local.save(roster);
        stats.downloaded += 1;
      }
      meta[roster.id] = { version: item.version, updatedAt: roster.updatedAt };
    }
    writeMeta(storage, meta);
    return stats;
  }

  window.addEventListener("online", () => void synchronize());

  return {
    contractVersion: 1,
    save,
    async read(id) {
      const current = await local.read(id);
      if (current) return current;
      await synchronize();
      return local.read(id);
    },
    async list() {
      await synchronize();
      return local.list();
    },
    syncNow: synchronize,
  };
}

function createConflictCopy(roster: StoredRoster): StoredRoster {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  return {
    ...roster,
    id,
    name: `${roster.name} (локальная конфликтная копия)`.slice(0, 80),
    roster: { ...roster.roster, id },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function readMeta(storage: Storage) {
  return readStored(storage, metaKey, metaSchema, {});
}

function writeMeta(storage: Storage, value: z.infer<typeof metaSchema>): void {
  storage.setItem(metaKey, JSON.stringify(value));
}

function readQueue(storage: Storage): string[] {
  return readStored(storage, queueKey, queueSchema, []);
}

function writeQueue(storage: Storage, value: readonly string[]): void {
  storage.setItem(queueKey, JSON.stringify([...new Set(value)]));
}

function removeQueued(storage: Storage, id: string): void {
  writeQueue(
    storage,
    readQueue(storage).filter((item) => item !== id),
  );
}

function readStored<T>(storage: Storage, key: string, schema: z.ZodType<T>, fallback: T): T {
  const value = storage.getItem(key);
  if (!value) return fallback;
  try {
    const parsed = schema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : fallback;
  } catch {
    return fallback;
  }
}
