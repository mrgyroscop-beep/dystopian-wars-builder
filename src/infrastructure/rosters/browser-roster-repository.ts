import { storedRosterSchema, type StoredRoster } from "../../application/rosters/create-roster";
import type { RosterLibraryRepository } from "../../application/rosters/roster-library";

const keyPrefix = "dwb.roster.v1.";

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
        return Promise.resolve(parsed.success ? (parsed.data as unknown as StoredRoster) : null);
      } catch {
        return Promise.resolve(null);
      }
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
          if (parsed.success) rosters.push(parsed.data as unknown as StoredRoster);
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
