import { z } from "zod";

import {
  battleRoomSchema,
  type BattleGateway,
  type BattleUpdate,
  type RoomKey,
} from "../../application/battle/battle-contract";

const responseSchema = z.object({ game: battleRoomSchema });

export function createHttpBattleGateway(fetcher: typeof fetch = fetch): BattleGateway {
  const path = (key: RoomKey) => `/api/battles/${key.join(".")}`;
  return {
    contractVersion: 1,
    async create(rosterId) {
      return responseSchema.parse(
        await request(fetcher, "/api/battles", {
          method: "POST",
          body: JSON.stringify({ rosterId }),
        }),
      ).game;
    },
    async join(key, rosterId) {
      return responseSchema.parse(
        await request(fetcher, "/api/battles/join", {
          method: "POST",
          body: JSON.stringify({ key, rosterId }),
        }),
      ).game;
    },
    async read(key, signal) {
      return responseSchema.parse(await request(fetcher, path(key), signal ? { signal } : {})).game;
    },
    async update(key, expectedVersion, update: BattleUpdate) {
      return responseSchema.parse(
        await request(fetcher, path(key), {
          method: "PATCH",
          body: JSON.stringify({ expectedVersion, update }),
        }),
      ).game;
    },
    async leave(key) {
      await request(fetcher, path(key), { method: "DELETE", body: "{}" });
    },
  };
}

async function request(fetcher: typeof fetch, url: string, init: RequestInit): Promise<unknown> {
  const response = await fetcher(url, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(payload);
    throw new Error(
      parsed.success ? parsed.data.error.message : `API вернул HTTP ${response.status}.`,
    );
  }
  return payload;
}
