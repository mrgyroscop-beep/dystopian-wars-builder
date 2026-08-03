import { Hono, type Context } from "hono";
import { z } from "zod";

import { storedRosterSchema, type StoredRoster } from "../src/application/rosters/create-roster";
import { requireSessionUser } from "./auth";
import { HttpError, readBoundedJson } from "./http";

const rosterIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u);
const writeSchema = z
  .object({ expectedVersion: z.number().int().min(0), roster: storedRosterSchema })
  .strict();
const versionSchema = z.object({ expectedVersion: z.number().int().min(1) }).strict();

interface RosterRow {
  id: string;
  version: number;
  document: string;
  deleted_at: number | null;
}

export const rosterRoutes = new Hono<{ Bindings: Env }>();

rosterRoutes.get("/", async (context) => {
  const user = await requireSessionUser(context);
  const result = await context.env.DB.prepare(
    "SELECT id, version, document, deleted_at FROM rosters WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC",
  )
    .bind(user.id)
    .all<RosterRow>();
  context.header("Cache-Control", "no-store");
  return context.json({ rosters: result.results.map(projectRow) });
});

rosterRoutes.get("/export", async (context) => {
  const user = await requireSessionUser(context);
  const result = await context.env.DB.prepare(
    "SELECT id, version, document, deleted_at FROM rosters WHERE user_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC",
  )
    .bind(user.id)
    .all<RosterRow>();
  context.header("Cache-Control", "no-store");
  context.header("Content-Disposition", 'attachment; filename="dystopian-wars-rosters.json"');
  return context.json({
    format: "dystopian-wars-builder-backup",
    version: 1,
    rosters: result.results.map(projectRow),
  });
});

rosterRoutes.get("/:id", async (context) => {
  const user = await requireSessionUser(context);
  const id = rosterIdSchema.parse(context.req.param("id"));
  const row = await findRoster(context.env.DB, user.id, id);
  if (!row || row.deleted_at !== null)
    throw new HttpError(404, "roster_not_found", "Roster was not found.");
  context.header("Cache-Control", "no-store");
  return context.json(projectRow(row));
});

rosterRoutes.put("/:id", async (context) => {
  const user = await requireSessionUser(context);
  const id = rosterIdSchema.parse(context.req.param("id"));
  const input = writeSchema.parse(await readBoundedJson(context));
  if (input.roster.id !== id)
    throw new HttpError(400, "roster_id_mismatch", "Roster id does not match the route.");
  const document = JSON.stringify(input.roster);
  const now = unixTime();
  const current = await findRoster(context.env.DB, user.id, id);

  if (!current) {
    if (input.expectedVersion !== 0) return conflict(context, null);
    try {
      await context.env.DB.batch([
        context.env.DB.prepare(
          "INSERT INTO rosters (user_id, id, version, document, deleted_at, created_at, updated_at) VALUES (?, ?, 1, ?, NULL, ?, ?)",
        ).bind(user.id, id, document, now, now),
        context.env.DB.prepare(
          "INSERT INTO roster_revisions (user_id, roster_id, version, document, deleted, created_at) VALUES (?, ?, 1, ?, 0, ?)",
        ).bind(user.id, id, document, now),
      ]);
    } catch {
      return conflict(context, await findRoster(context.env.DB, user.id, id));
    }
    return context.json({ version: 1, roster: input.roster }, 201);
  }

  if (current.deleted_at !== null || current.version !== input.expectedVersion)
    return conflict(context, current);
  const nextVersion = current.version + 1;
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      "UPDATE rosters SET version = ?, document = ?, updated_at = ? WHERE user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL",
    ).bind(nextVersion, document, now, user.id, id, input.expectedVersion),
    context.env.DB.prepare(
      "INSERT OR IGNORE INTO roster_revisions (user_id, roster_id, version, document, deleted, created_at) SELECT user_id, id, version, document, 0, ? FROM rosters WHERE user_id = ? AND id = ? AND version = ? AND document = ?",
    ).bind(now, user.id, id, nextVersion, document),
  ]);
  if (results[0]?.meta.changes !== 1)
    return conflict(context, await findRoster(context.env.DB, user.id, id));
  return context.json({ version: nextVersion, roster: input.roster });
});

rosterRoutes.delete("/:id", async (context) => {
  const user = await requireSessionUser(context);
  const id = rosterIdSchema.parse(context.req.param("id"));
  const input = versionSchema.parse(await readBoundedJson(context));
  const now = unixTime();
  const nextVersion = input.expectedVersion + 1;
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      "UPDATE rosters SET version = ?, deleted_at = ?, updated_at = ? WHERE user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL",
    ).bind(nextVersion, now, now, user.id, id, input.expectedVersion),
    context.env.DB.prepare(
      "INSERT OR IGNORE INTO roster_revisions (user_id, roster_id, version, document, deleted, created_at) SELECT user_id, id, version, NULL, 1, ? FROM rosters WHERE user_id = ? AND id = ? AND version = ? AND deleted_at = ?",
    ).bind(now, user.id, id, nextVersion, now),
  ]);
  if (results[0]?.meta.changes !== 1)
    return conflict(context, await findRoster(context.env.DB, user.id, id));
  return context.json({ version: nextVersion, deleted: true });
});

rosterRoutes.post("/:id/restore", async (context) => {
  const user = await requireSessionUser(context);
  const id = rosterIdSchema.parse(context.req.param("id"));
  const input = versionSchema.parse(await readBoundedJson(context));
  const now = unixTime();
  const nextVersion = input.expectedVersion + 1;
  const results = await context.env.DB.batch([
    context.env.DB.prepare(
      "UPDATE rosters SET version = ?, deleted_at = NULL, updated_at = ? WHERE user_id = ? AND id = ? AND version = ? AND deleted_at IS NOT NULL",
    ).bind(nextVersion, now, user.id, id, input.expectedVersion),
    context.env.DB.prepare(
      "INSERT OR IGNORE INTO roster_revisions (user_id, roster_id, version, document, deleted, created_at) SELECT user_id, id, version, document, 0, ? FROM rosters WHERE user_id = ? AND id = ? AND version = ? AND deleted_at IS NULL",
    ).bind(now, user.id, id, nextVersion),
  ]);
  if (results[0]?.meta.changes !== 1)
    return conflict(context, await findRoster(context.env.DB, user.id, id));
  const restored = await findRoster(context.env.DB, user.id, id);
  if (!restored) throw new HttpError(404, "roster_not_found", "Roster was not found.");
  return context.json(projectRow(restored));
});

async function findRoster(database: D1Database, userId: string, id: string) {
  return database
    .prepare("SELECT id, version, document, deleted_at FROM rosters WHERE user_id = ? AND id = ?")
    .bind(userId, id)
    .first<RosterRow>();
}

function projectRow(row: RosterRow): { version: number; roster: StoredRoster } {
  const roster: unknown = JSON.parse(row.document);
  if (!isStoredRoster(roster)) throw new Error("Stored roster failed its persistence contract.");
  return {
    version: row.version,
    roster,
  };
}

function isStoredRoster(value: unknown): value is StoredRoster {
  return storedRosterSchema.safeParse(value).success;
}

function conflict(context: Context<{ Bindings: Env }>, current: RosterRow | null) {
  return context.json(
    {
      error: { code: "version_conflict", message: "Roster changed on another device." },
      current: current && current.deleted_at === null ? projectRow(current) : null,
    },
    409,
  );
}

function unixTime(): number {
  return Math.floor(Date.now() / 1000);
}
