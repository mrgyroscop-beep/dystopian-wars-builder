import { env, exports } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { healthResponseSchema } from "../src/application/health/health-contract";
import { retrieveSources } from "./assistant";
import { parseTranslation } from "./glossary";
import { sha256 } from "./http";
import { resolveReferenceDocument } from "./reference-pdf";

const feedbackAutomationToken = "test-feedback-automation-token-with-enough-entropy";

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
    env.DB.prepare("DELETE FROM feedback"),
    env.DB.prepare("DELETE FROM roster_revisions"),
    env.DB.prepare("DELETE FROM rosters"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM password_credentials"),
    env.DB.prepare("DELETE FROM users"),
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

  it("does not proxy arbitrary reference document URLs", async () => {
    const response = await exports.default.fetch("http://example.com/reference-pdf/not-allowed");
    const payload: unknown = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      error: {
        code: "document_not_found",
        message: "Document not found.",
      },
    });
  });

  it("allows only the current official ORBAT documents", () => {
    expect(
      [
        "alliance",
        "commonwealth",
        "crown",
        "empire",
        "enlightened",
        "imperium",
        "sultanate",
        "union",
      ].map((faction) => resolveReferenceDocument(`orbat-${faction}`)?.url),
    ).toEqual([
      "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Alliance-4.01-Beta_W.pdf",
      "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Commonwealth-400a_W.pdf",
      "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Crown_Full-4.02a.pdf",
      "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Empire_Full-4.01_W.pdf",
      "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Enlightened-v4.01-Beta2_W.pdf",
      "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Imperium-400b_W.pdf",
      "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Sultanate-4.01_W.pdf",
      "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Union-4.00a_W.pdf",
    ]);
  });

  it("registers and signs in with email and password", async () => {
    const headers = { "Content-Type": "application/json", Origin: "http://example.com" };
    const registration = await exports.default.fetch("http://example.com/api/auth/register", {
      method: "POST",
      headers,
      body: JSON.stringify({
        displayName: "Admiral",
        email: "Admiral@Example.com",
        password: "correct-horse-battery-staple",
      }),
    });
    const login = await exports.default.fetch("http://example.com/api/auth/login", {
      method: "POST",
      headers,
      body: JSON.stringify({
        email: "admiral@example.com",
        password: "correct-horse-battery-staple",
      }),
    });
    const sessionCookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const session = await exports.default.fetch("http://example.com/api/auth/session", {
      headers: { Cookie: sessionCookie },
    });

    expect(registration.status).toBe(201);
    expect(login.status).toBe(200);
    expect(sessionCookie).toMatch(/^dwb_session=/u);
    await expect(session.json()).resolves.toMatchObject({
      user: { displayName: "Admiral" },
    });
    await expect(
      env.DB.prepare("SELECT email, password_iterations FROM password_credentials").first<{
        email: string;
        password_iterations: number;
      }>(),
    ).resolves.toEqual({ email: "admiral@example.com", password_iterations: 100_000 });
  });

  it("uses one generic error for invalid credentials", async () => {
    const response = await exports.default.fetch("http://example.com/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://example.com" },
      body: JSON.stringify({ email: "missing@example.com", password: "wrong-password" }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: { code: "invalid_credentials", message: "Неверный email или пароль." },
    });
  });

  it("requires an account before asking the rules assistant", async () => {
    const response = await exports.default.fetch("http://example.com/api/assistant/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://example.com" },
      body: JSON.stringify({ question: "How does All-Around work?", history: [] }),
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "authentication_required" },
    });
  });

  it("finds glossary rules by punctuation and Russian translations with PDF pages", () => {
    expect(retrieveSources("Как работает All-Around?")[0]).toMatchObject({
      title: "All Around",
      page: 26,
    });
    expect(retrieveSources("Когда можно использовать торпеду?")[0]).toMatchObject({
      title: "Torpedo",
      page: 32,
    });
    expect(retrieveSources("Аблятив армор")[0]).toMatchObject({
      title: "Ablative Armour",
    });
    expect(retrieveSources("Эскорт")[0]).toMatchObject({ title: "Escort" });
    expect(retrieveSources("Torpdeo")[0]).toMatchObject({ title: "Torpedo" });
    expect(retrieveSources("фывапролдж")).toEqual([]);
  });

  it("publishes the text glossary and validates structured translations", async () => {
    const response = await exports.default.fetch("http://example.com/api/glossary");
    const payload = await response.json<{ rules: Array<{ id: string; title: string }> }>();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    expect(payload.rules.length).toBeGreaterThan(300);
    expect(payload.rules).toContainEqual(expect.objectContaining({ title: "All Around" }));
    expect(parseTranslation('{"title":"Круговой огонь","text":"Точный перевод."}')).toEqual({
      title: "Круговой огонь",
      text: "Точный перевод.",
    });
    expect(() => parseTranslation("not-json")).toThrow("Перевод сейчас недоступен.");
  });

  it("limits the rules assistant to five questions per minute", async () => {
    const headers = { "Content-Type": "application/json", Origin: "http://example.com" };
    const registration = await exports.default.fetch("http://example.com/api/auth/register", {
      method: "POST",
      headers,
      body: JSON.stringify({
        displayName: "Rate Tester",
        email: "rate-tester@example.com",
        password: "correct-horse-battery-staple",
      }),
    });
    const sessionCookie = registration.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    const user = await env.DB.prepare("SELECT id FROM users WHERE display_name = ?")
      .bind("Rate Tester")
      .first<{ id: string }>();
    if (!user) throw new Error("Registered test user was not stored.");

    const unknownRule = await exports.default.fetch("http://example.com/api/assistant/ask", {
      method: "POST",
      headers: { ...headers, Cookie: sessionCookie },
      body: JSON.stringify({ question: "фывапролдж", history: [] }),
    });
    expect(unknownRule.status).toBe(200);
    const unknownPayload = await unknownRule.json<{ answer: string; sources: unknown[] }>();
    expect(unknownPayload.answer).toContain("Не нашёл правило");
    expect(unknownPayload.sources).toEqual([]);

    await env.DB.prepare(
      "INSERT INTO rate_limits (bucket, window_started_at, request_count) VALUES (?, ?, 5) ON CONFLICT(bucket) DO UPDATE SET window_started_at = excluded.window_started_at, request_count = excluded.request_count",
    )
      .bind(`assistant:${user.id}`, Math.floor(Date.now() / 1000))
      .run();

    const response = await exports.default.fetch("http://example.com/api/assistant/ask", {
      method: "POST",
      headers: { ...headers, Cookie: sessionCookie },
      body: JSON.stringify({ question: "Как работает торпеда?", history: [] }),
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: { code: "rate_limited", message: "Лимит — 5 вопросов в минуту. Попробуйте позже." },
    });
  });

  it("stores private feedback idempotently and normalizes the optional email", async () => {
    const body = {
      requestId: "12345678-1234-4123-8123-123456789abc",
      kind: "idea",
      message: "Добавьте французский ORBAT.",
      email: "Admiral@Example.com",
      source: "/feedback",
      appVersion: "0.1.0",
      catalogVersion: "not-imported",
      commitSha: "test-sha",
    };
    const request = () =>
      exports.default.fetch("http://example.com/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: "http://example.com" },
        body: JSON.stringify(body),
      });
    const first = await request();
    const duplicate = await request();

    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(200);
    const receipt = await first.json<{ id: string; duplicate: boolean }>();
    await expect(duplicate.json()).resolves.toEqual({ ...receipt, duplicate: true });
    await expect(
      env.DB.prepare("SELECT contact_email FROM feedback").first<string>("contact_email"),
    ).resolves.toBe("admiral@example.com");
  });

  it("leases feedback only to the authorized automation and acknowledges its claim", async () => {
    const submitted = await exports.default.fetch("http://example.com/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "http://example.com" },
      body: JSON.stringify({
        requestId: "87654321-4321-4123-8123-cba987654321",
        kind: "bug",
        message: "Не открывается карточка корабля.",
        email: "captain@example.com",
        source: "/rosters/demo",
        appVersion: "0.1.0",
        catalogVersion: "not-imported",
        commitSha: "test-sha",
      }),
    });
    expect(submitted.status).toBe(201);

    const denied = await exports.default.fetch("http://example.com/api/feedback/automation/claim", {
      method: "POST",
      headers: { Authorization: "Bearer wrong", "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 1, leaseSeconds: 900 }),
    });
    expect(denied.status).toBe(401);

    const claimed = await exports.default.fetch(
      "http://example.com/api/feedback/automation/claim",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${feedbackAutomationToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ limit: 1, leaseSeconds: 900 }),
      },
    );
    const claim = await claimed.json<{
      items: Array<{ id: string; contact: string; claimToken: string }>;
    }>();
    expect(claim.items[0]).toMatchObject({ contact: "captain@example.com" });

    const acknowledged = await exports.default.fetch(
      `http://example.com/api/feedback/automation/${claim.items[0]?.id}/ack`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${feedbackAutomationToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ claimToken: claim.items[0]?.claimToken }),
      },
    );
    expect(acknowledged.status).toBe(200);
    await expect(
      env.DB.prepare("SELECT state, contact_email FROM feedback").first<{
        state: string;
        contact_email: string | null;
      }>(),
    ).resolves.toEqual({ state: "acknowledged", contact_email: null });
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
