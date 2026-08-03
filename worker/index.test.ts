import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { healthResponseSchema } from "../src/application/health/health-contract";
import { sha256 } from "./http";

declare global {
  // Cloudflare's generated Env augmentation uses a namespace by design.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM roster_revisions"),
    env.DB.prepare("DELETE FROM rosters"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM passkeys"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("DELETE FROM auth_challenges"),
    env.DB.prepare("DELETE FROM rate_limits"),
  ]);
});

describe("Worker API", () => {
  it("returns a validated health response", async () => {
    const response = await exports.default.fetch("http://example.com/api/health");
    const payload: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(healthResponseSchema.parse(payload)).toEqual({
      status: "ok",
      environment: "local",
      appVersion: "0.1.0",
      catalogVersion: "not-imported",
      commitSha: "0000000000000000000000000000000000000000",
    });

    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("returns JSON 404 for an unknown API route", async () => {
    const response = await exports.default.fetch("http://example.com/api/missing");
    const payload: unknown = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      error: {
        code: "not_found",
        message: "API route not found.",
      },
    });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("generates a rate-limited passkey registration challenge", async () => {
    const response = await exports.default.fetch(
      "http://example.com/api/auth/passkey/register/options",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://example.com" },
        body: JSON.stringify({ displayName: "Admiral" }),
      },
    );
    const payload = await response.json<{
      transactionId: string;
      options: { challenge: string };
    }>();

    expect(response.status).toBe(200);
    expect(payload.transactionId).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(payload.options.challenge).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM auth_challenges").first<number>("count"),
    ).toBe(1);
  });

  it("isolates rosters by user and reports optimistic concurrency conflicts", async () => {
    const token = "test-session-token";
    const now = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO users (id, display_name, webauthn_user_id, created_at, updated_at) VALUES ('user-a', 'A', 'wa', ?, ?)",
      ).bind(now, now),
      env.DB.prepare(
        "INSERT INTO users (id, display_name, webauthn_user_id, created_at, updated_at) VALUES ('user-b', 'B', 'wb', ?, ?)",
      ).bind(now, now),
      env.DB.prepare(
        "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, 'user-a', ?, ?)",
      ).bind(await sha256(token), now + 3600, now),
      env.DB.prepare(
        "INSERT INTO rosters (user_id, id, version, document, deleted_at, created_at, updated_at) VALUES ('user-b', 'private-b', 1, ?, NULL, ?, ?)",
      ).bind(JSON.stringify(roster("private-b", "Private B")), now, now),
    ]);
    const headers = {
      "Content-Type": "application/json",
      Cookie: `dwb_session=${token}`,
      Origin: "http://example.com",
    };
    const created = await exports.default.fetch("http://example.com/api/rosters/fleet-a", {
      method: "PUT",
      headers,
      body: JSON.stringify({ expectedVersion: 0, roster: roster("fleet-a", "Fleet A") }),
    });
    const list = await exports.default.fetch("http://example.com/api/rosters", { headers });
    const listPayload = await list.json<{ rosters: Array<{ roster: { id: string } }> }>();
    const conflict = await exports.default.fetch("http://example.com/api/rosters/fleet-a", {
      method: "PUT",
      headers,
      body: JSON.stringify({ expectedVersion: 0, roster: roster("fleet-a", "Stale") }),
    });

    expect(created.status).toBe(201);
    expect(listPayload.rosters.map((item) => item.roster.id)).toEqual(["fleet-a"]);
    expect(conflict.status).toBe(409);
  });
});

function roster(id: string, name: string) {
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
