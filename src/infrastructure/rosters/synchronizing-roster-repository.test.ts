import { afterEach, describe, expect, it, vi } from "vitest";

import type { StoredRoster } from "../../application/rosters/create-roster";
import { createBrowserRosterRepository } from "./browser-roster-repository";
import { createSynchronizingRosterRepository } from "./synchronizing-roster-repository";

afterEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("synchronizing roster repository", () => {
  it("removes a saved roster locally", async () => {
    vi.useFakeTimers();
    const repository = createSynchronizingRosterRepository(
      createBrowserRosterRepository(window.localStorage),
      window.localStorage,
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
    );
    const saved = roster("fleet-a", "Saved fleet");
    await repository.save(saved);

    await repository.remove(saved.id);

    expect(await repository.read(saved.id)).toBeNull();
    expect(await repository.list()).toEqual([]);
  });

  it("synchronizes a deletion using the known remote version", async () => {
    vi.useFakeTimers();
    const saved = roster("fleet-a", "Saved fleet");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ rosters: [{ version: 3, roster: saved }] }))
      .mockResolvedValueOnce(Response.json({ version: 4, deleted: true }))
      .mockImplementation(() => Promise.resolve(Response.json({ rosters: [] })));
    const repository = createSynchronizingRosterRepository(
      createBrowserRosterRepository(window.localStorage),
      window.localStorage,
      fetcher,
    );
    await repository.syncNow();

    await repository.remove(saved.id);
    await repository.syncNow();

    expect(fetcher).toHaveBeenCalledWith(
      "/api/rosters/fleet-a",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ expectedVersion: 3 }),
      }),
    );
    expect(await repository.read(saved.id)).toBeNull();
  });

  it("keeps a queued local copy when the network is unavailable", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    const repository = createSynchronizingRosterRepository(
      createBrowserRosterRepository(window.localStorage),
      window.localStorage,
      fetcher,
    );
    const local = roster("fleet-a", "Offline fleet");

    await repository.save(local);

    expect(await repository.read(local.id)).toEqual(local);
    expect(JSON.parse(window.localStorage.getItem("dwb.sync.v1.queue") ?? "[]")).toEqual([
      local.id,
    ]);
  });

  it("preserves a local conflict as a separate copy and adopts the remote version", async () => {
    vi.useFakeTimers();
    const remote = roster("fleet-a", "Remote fleet");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("offline"))
      .mockResolvedValueOnce(
        Response.json({ current: { version: 2, roster: remote } }, { status: 409 }),
      )
      .mockResolvedValueOnce(Response.json({ rosters: [{ version: 2, roster: remote }] }));
    const repository = createSynchronizingRosterRepository(
      createBrowserRosterRepository(window.localStorage),
      window.localStorage,
      fetcher,
    );
    await repository.save(roster("fleet-a", "Local fleet"));

    const result = await repository.syncNow();
    const saved = await repository.list();

    expect(result.conflicts).toBe(1);
    expect(saved.map((item) => item.name).sort()).toEqual([
      "Local fleet (локальная конфликтная копия)",
      "Remote fleet",
    ]);
  });
});

function roster(id: string, name: string): StoredRoster {
  const timestamp = "2026-08-03T08:00:00.000Z";
  return {
    contractVersion: 1,
    id,
    name,
    faction: { id: "faction", label: "Faction" },
    battlefleet: { id: "battlefleet", label: "Battlefleet" },
    limits: { points: 100, victoryPoints: 10 },
    requiredElements: [],
    roster: {
      contractVersion: 1,
      id,
      catalogContentVersion: "demo",
      rootInstanceIds: [],
      instances: {},
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
