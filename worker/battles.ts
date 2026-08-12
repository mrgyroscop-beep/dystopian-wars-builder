import { Hono } from "hono";
import { z } from "zod";

import {
  criticalEffectIds,
  roomKeySchema,
  shipBattleStateSchema,
  type BattleSide,
  type RoomKey,
  type ShipBattleState,
} from "../src/application/battle/battle-contract";
import { storedRosterSchema, type StoredRoster } from "../src/application/rosters/create-roster";
import { requireSessionUser, type SessionUser } from "./auth";
import { HttpError, readBoundedJson } from "./http";

const rosterIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u);
const createSchema = z.object({ rosterId: rosterIdSchema }).strict();
const joinSchema = z.object({ key: roomKeySchema, rosterId: rosterIdSchema }).strict();
const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    update: z.discriminatedUnion("type", [
      z.object({ type: z.literal("ready"), ready: z.boolean() }).strict(),
      z
        .object({
          type: z.literal("round"),
          round: z.number().int().min(1).max(20),
          activeSide: z.enum(["host", "guest"]),
        })
        .strict(),
      z
        .object({
          type: z.literal("ship"),
          shipId: z.string().min(1).max(240),
          state: shipBattleStateSchema,
        })
        .strict(),
    ]),
  })
  .strict();

interface BattleRoomRow {
  id: string;
  room_key: string;
  host_user_id: string;
  guest_user_id: string | null;
  host_roster_json: string;
  guest_roster_json: string | null;
  host_state_json: string;
  guest_state_json: string;
  host_ready: number;
  guest_ready: number;
  round_number: number;
  active_side: BattleSide;
  status: "waiting" | "preparing" | "active" | "finished";
  version: number;
  expires_at: number;
  host_name: string;
  guest_name: string | null;
}

const ROOM_TTL_SECONDS = 24 * 60 * 60;
const effectSet = new Set<string>(criticalEffectIds);

export const battleRoutes = new Hono<{ Bindings: Env }>();

battleRoutes.post("/", async (context) => {
  const user = await requireSessionUser(context);
  const input = createSchema.parse(await readBoundedJson(context));
  const roster = await ownedRoster(context.env.DB, user.id, input.rosterId);
  const now = unixTime();
  await context.env.DB.prepare("DELETE FROM battle_rooms WHERE expires_at <= ?").bind(now).run();

  let roomKey = "";
  for (let attempt = 0; attempt < 12 && !roomKey; attempt += 1) {
    const candidate = randomRoomKey().join(".");
    try {
      await context.env.DB.prepare(
        `INSERT INTO battle_rooms
          (id, room_key, host_user_id, host_roster_json, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          crypto.randomUUID(),
          candidate,
          user.id,
          JSON.stringify(roster),
          now,
          now,
          now + ROOM_TTL_SECONDS,
        )
        .run();
      roomKey = candidate;
    } catch {
      // A three-die key has a small space; retry on an active-room collision.
    }
  }
  if (!roomKey)
    throw new HttpError(503, "room_capacity", "Все короткие ключи заняты. Повторите позже.");
  const room = await selectRoom(context.env.DB, roomKey);
  if (!room) throw new Error("Created battle room could not be read.");
  return context.json(roomResponse(room, user), 201);
});

battleRoutes.post("/join", async (context) => {
  const user = await requireSessionUser(context);
  const input = joinSchema.parse(await readBoundedJson(context));
  const key = serializeKey(input.key);
  const roster = await ownedRoster(context.env.DB, user.id, input.rosterId);
  const existing = await activeRoom(context.env.DB, key);
  if (existing.host_user_id === user.id || existing.guest_user_id === user.id)
    return context.json(roomResponse(existing, user));
  if (existing.guest_user_id)
    throw new HttpError(409, "room_full", "В комнате уже находятся два адмирала.");

  const now = unixTime();
  const result = await context.env.DB.prepare(
    `UPDATE battle_rooms
     SET guest_user_id = ?, guest_roster_json = ?, guest_state_json = '{}', status = 'preparing',
         version = version + 1, updated_at = ?
     WHERE room_key = ? AND guest_user_id IS NULL AND status = 'waiting' AND expires_at > ?`,
  )
    .bind(user.id, JSON.stringify(roster), now, key, now)
    .run();
  if (result.meta.changes !== 1)
    throw new HttpError(409, "room_full", "К комнате уже присоединился другой адмирал.");
  const room = await selectRoom(context.env.DB, key);
  if (!room) throw new Error("Joined battle room could not be read.");
  return context.json(roomResponse(room, user));
});

battleRoutes.get("/:key", async (context) => {
  const user = await requireSessionUser(context);
  const room = await activeRoom(context.env.DB, normalizePathKey(context.req.param("key")));
  roomSide(room, user);
  context.header("Cache-Control", "no-store");
  return context.json(roomResponse(room, user));
});

battleRoutes.patch("/:key", async (context) => {
  const user = await requireSessionUser(context);
  const key = normalizePathKey(context.req.param("key"));
  const room = await activeRoom(context.env.DB, key);
  const side = roomSide(room, user);
  const input = updateSchema.parse(await readBoundedJson(context));
  if (input.expectedVersion !== room.version)
    throw new HttpError(
      409,
      "version_conflict",
      "Состояние баталии уже изменилось. Обновите комнату.",
    );
  if (room.status === "finished")
    throw new HttpError(409, "battle_finished", "Баталия уже завершена.");

  const assignments: string[] = [];
  const values: unknown[] = [];
  if (input.update.type === "ready") {
    if (room.status === "active")
      throw new HttpError(409, "battle_started", "После начала баталии готовность зафиксирована.");
    assignments.push(`${side}_ready = ?`);
    values.push(input.update.ready ? 1 : 0);
    const otherReady = side === "host" ? room.guest_ready === 1 : room.host_ready === 1;
    assignments.push("status = ?");
    values.push(
      input.update.ready && otherReady ? "active" : room.guest_user_id ? "preparing" : "waiting",
    );
  } else if (input.update.type === "round") {
    if (room.status !== "active")
      throw new HttpError(
        409,
        "battle_not_started",
        "Сначала оба адмирала должны подтвердить готовность.",
      );
    assignments.push("round_number = ?", "active_side = ?");
    values.push(input.update.round, input.update.activeSide);
  } else {
    if (room.status !== "active")
      throw new HttpError(
        409,
        "battle_not_started",
        "Сначала оба адмирала должны подтвердить готовность.",
      );
    const roster = parseRoster(side === "host" ? room.host_roster_json : room.guest_roster_json);
    if (!roster.roster.instances[input.update.shipId])
      throw new HttpError(400, "ship_not_in_roster", "Этого корабля нет в выбранном флоте.");
    const state = parseShipState(side === "host" ? room.host_state_json : room.guest_state_json);
    state[input.update.shipId] = input.update.state;
    assignments.push(`${side}_state_json = ?`);
    values.push(JSON.stringify(state));
  }

  const now = unixTime();
  const result = await context.env.DB.prepare(
    `UPDATE battle_rooms SET ${assignments.join(", ")}, version = version + 1, updated_at = ?
     WHERE room_key = ? AND version = ? AND (host_user_id = ? OR guest_user_id = ?)`,
  )
    .bind(...values, now, key, room.version, user.id, user.id)
    .run();
  if (result.meta.changes !== 1)
    throw new HttpError(
      409,
      "version_conflict",
      "Состояние баталии уже изменилось. Обновите комнату.",
    );
  const updated = await selectRoom(context.env.DB, key);
  if (!updated) throw new Error("Updated battle room could not be read.");
  return context.json(roomResponse(updated, user));
});

battleRoutes.delete("/:key", async (context) => {
  const user = await requireSessionUser(context);
  const key = normalizePathKey(context.req.param("key"));
  const room = await activeRoom(context.env.DB, key);
  const side = roomSide(room, user);
  const now = unixTime();
  if (side === "host") {
    await context.env.DB.prepare(
      "UPDATE battle_rooms SET status = 'finished', version = version + 1, updated_at = ? WHERE room_key = ? AND host_user_id = ?",
    )
      .bind(now, key, user.id)
      .run();
  } else {
    await context.env.DB.prepare(
      `UPDATE battle_rooms SET guest_user_id = NULL, guest_roster_json = NULL, guest_state_json = '{}',
       guest_ready = 0, host_ready = 0, status = 'waiting', version = version + 1, updated_at = ?
       WHERE room_key = ? AND guest_user_id = ?`,
    )
      .bind(now, key, user.id)
      .run();
  }
  return context.json({ ok: true });
});

async function ownedRoster(database: D1Database, userId: string, rosterId: string) {
  const row = await database
    .prepare("SELECT document FROM rosters WHERE user_id = ? AND id = ? AND deleted_at IS NULL")
    .bind(userId, rosterId)
    .first<{ document: string }>();
  if (!row)
    throw new HttpError(404, "roster_not_found", "Синхронизируйте выбранный флот с аккаунтом.");
  return parseRoster(row.document);
}

function parseRoster(document: string | null): StoredRoster {
  if (!document) throw new Error("Battle roster is missing.");
  const parsed: unknown = JSON.parse(document);
  const roster = storedRosterSchema.safeParse(parsed);
  if (!roster.success) throw new Error("Battle roster failed its persistence contract.");
  return roster.data as unknown as StoredRoster;
}

function parseShipState(document: string): Record<string, ShipBattleState> {
  const parsed: unknown = JSON.parse(document);
  const result = z.record(z.string(), shipBattleStateSchema).safeParse(parsed);
  if (!result.success) throw new Error("Battle ship state failed its persistence contract.");
  return result.data;
}

function roomResponse(room: BattleRoomRow, user: SessionUser) {
  return {
    game: {
      key: deserializeKey(room.room_key),
      you: roomSide(room, user),
      status: room.status,
      version: room.version,
      round: room.round_number,
      activeSide: room.active_side,
      expiresAt: new Date(room.expires_at * 1000).toISOString(),
      host: {
        displayName: room.host_name,
        roster: parseRoster(room.host_roster_json),
        ready: room.host_ready === 1,
        shipState: parseShipState(room.host_state_json),
      },
      guest: room.guest_user_id
        ? {
            displayName: room.guest_name ?? "Адмирал II",
            roster: parseRoster(room.guest_roster_json),
            ready: room.guest_ready === 1,
            shipState: parseShipState(room.guest_state_json),
          }
        : null,
    },
  };
}

function selectRoom(database: D1Database, key: string) {
  return database
    .prepare(
      `SELECT battle_rooms.*, host.display_name AS host_name, guest.display_name AS guest_name
       FROM battle_rooms JOIN users AS host ON host.id = battle_rooms.host_user_id
       LEFT JOIN users AS guest ON guest.id = battle_rooms.guest_user_id
       WHERE battle_rooms.room_key = ?`,
    )
    .bind(key)
    .first<BattleRoomRow>();
}

async function activeRoom(database: D1Database, key: string): Promise<BattleRoomRow> {
  const room = await selectRoom(database, key);
  if (!room || room.expires_at <= unixTime())
    throw new HttpError(404, "room_not_found", "Комната не найдена или уже закрыта.");
  return room;
}

function roomSide(room: BattleRoomRow, user: SessionUser): BattleSide {
  if (room.host_user_id === user.id) return "host";
  if (room.guest_user_id === user.id) return "guest";
  throw new HttpError(403, "room_forbidden", "Эта комната принадлежит другим адмиралам.");
}

function randomRoomKey(): RoomKey {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return roomKeySchema.parse(
    [...bytes].map((byte) => criticalEffectIds[byte % criticalEffectIds.length]),
  );
}

function serializeKey(key: RoomKey): string {
  return key.join(".");
}

function deserializeKey(value: string): RoomKey {
  return roomKeySchema.parse(value.split("."));
}

function normalizePathKey(value: string): string {
  const parts = value.toLocaleLowerCase("en").split(".");
  if (parts.length !== 3 || parts.some((part) => !effectSet.has(part)))
    throw new HttpError(400, "invalid_room_key", "Выберите три грани критического кубика.");
  return serializeKey(roomKeySchema.parse(parts));
}

function unixTime(): number {
  return Math.floor(Date.now() / 1000);
}
