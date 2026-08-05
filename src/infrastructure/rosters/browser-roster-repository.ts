import { storedRosterSchema, type StoredRoster } from "../../application/rosters/create-roster";
import type { RosterLibraryRepository } from "../../application/rosters/roster-library";

const keyPrefix = "dwb.roster.v1.";
const internalCatalogVersions = new Set(["demonstration-1"]);

export function createBrowserRosterRepository(storage: Storage): RosterLibraryRepository {
  return {
    contractVersion: 1,
    save(roster) {
      storage.setItem(`${keyPrefix}${roster.id}`, JSON.stringify(roster));
      return Promise.resolve();
    },
    read(id) {
      const value = storage.getItem(`${keyPrefix}${id}`);
      if (!value) return Promise.resolve(null);
      try {
        const parsed = storedRosterSchema.safeParse(JSON.parse(value));
        if (!parsed.success) return Promise.resolve(null);
        const roster = parsed.data as unknown as StoredRoster;
        return Promise.resolve(isUserRoster(roster) ? roster : null);
      } catch {
        return Promise.resolve(null);
      }
    },
    remove(id) {
      storage.removeItem(`${keyPrefix}${id}`);
      return Promise.resolve();
    },
    list() {
      const rosters: StoredRoster[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(keyPrefix)) continue;
        const value = storage.getItem(key);
        if (!value) continue;
        try {
          const parsed = storedRosterSchema.safeParse(JSON.parse(value));
          if (!parsed.success) continue;
          const roster = parsed.data as unknown as StoredRoster;
          if (isUserRoster(roster)) rosters.push(roster);
        } catch {
          // An invalid entry is isolated and never hides valid local fleets.
        }
      }
      return Promise.resolve(
        rosters.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      );
    },
  };
}

function isUserRoster(roster: StoredRoster): boolean {
  return !internalCatalogVersions.has(roster.roster.catalogContentVersion);
}
