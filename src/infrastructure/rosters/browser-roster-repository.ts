import {
  storedRosterSchema,
  type RosterRepository,
  type StoredRoster,
} from "../../application/rosters/create-roster";

const keyPrefix = "dwb.roster.v1.";

export function createBrowserRosterRepository(storage: Storage): RosterRepository {
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
  };
}
