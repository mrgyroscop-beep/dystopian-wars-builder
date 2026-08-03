import { Hono, type Context } from "hono";
import { z } from "zod";

import { HttpError, randomToken, readBoundedJson, sha256 } from "./http";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value));
const submissionSchema = z
  .object({
    requestId: z.string().uuid(),
    kind: z.enum(["feedback", "bug", "idea"]),
    message: z.string().trim().min(10).max(4000),
    email: emailSchema,
    source: z.string().trim().min(1).max(80),
    appVersion: z.string().trim().min(1).max(64),
    catalogVersion: z.string().trim().min(1).max(128),
    commitSha: z.string().trim().min(1).max(64),
  })
  .strict();
const claimSchema = z
  .object({
    limit: z.number().int().min(1).max(25).default(25),
    leaseSeconds: z.number().int().min(60).max(3600).default(900),
  })
  .strict();
const actionSchema = z
  .object({
    claimToken: z.string().min(20).max(200),
    retryAfterSeconds: z.number().int().min(30).max(86_400).optional(),
    reason: z.string().trim().min(1).max(300).optional(),
    error: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
const feedbackIdSchema = z.string().regex(/^fb_[0-9a-f-]{36}$/u);

interface StoredFeedback {
  id: string;
  payload_hash: string;
}

interface ClaimedFeedback {
  id: string;
  category: string;
  message: string;
  contact: string | null;
  source: string;
  appVersion: string;
  catalogVersion: string;
  commitSha: string;
  createdAt: number;
  attempts: number;
  leaseExpiresAt: number;
}

export const feedbackRoutes = new Hono<{ Bindings: Env }>();

feedbackRoutes.post("/", async (context) => {
  const input = submissionSchema.parse(await readBoundedJson(context));
  await enforceFeedbackRateLimit(context);
  const canonical = JSON.stringify({
    kind: input.kind,
    message: input.message,
    email: input.email,
    source: input.source,
    appVersion: input.appVersion,
    catalogVersion: input.catalogVersion,
    commitSha: input.commitSha,
  });
  const payloadHash = await sha256(canonical);
  const existing = await feedbackByRequestId(context.env.DB, input.requestId);
  if (existing) {
    if (existing.payload_hash !== payloadHash)
      throw new HttpError(409, "request_id_conflict", "Идентификатор обращения уже использован.");
    return context.json({ id: existing.id, duplicate: true });
  }

  const id = `fb_${crypto.randomUUID()}`;
  const now = unixTime();
  await context.env.DB.prepare(
    "INSERT OR IGNORE INTO feedback (id, request_id, payload_hash, kind, message, contact_email, source, app_version, catalog_version, commit_sha, state, attempts, available_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?)",
  )
    .bind(
      id,
      input.requestId,
      payloadHash,
      input.kind,
      input.message,
      input.email || null,
      input.source,
      input.appVersion,
      input.catalogVersion,
      input.commitSha,
      now,
      now,
      now,
    )
    .run();
  const stored = await feedbackByRequestId(context.env.DB, input.requestId);
  if (!stored) throw new Error("feedback_insert_failed");
  if (stored.payload_hash !== payloadHash)
    throw new HttpError(409, "request_id_conflict", "Идентификатор обращения уже использован.");
  return context.json({ id: stored.id, duplicate: stored.id !== id }, stored.id === id ? 201 : 200);
});

feedbackRoutes.post("/automation/claim", async (context) => {
  await requireAutomation(context);
  const input = claimSchema.parse(await readBoundedJson(context));
  const now = unixTime();
  const leaseExpiresAt = now + input.leaseSeconds;
  const claimToken = randomToken();
  const claimTokenHash = await sha256(claimToken);
  const result = await context.env.DB.prepare(
    `UPDATE feedback
     SET state = 'claimed', claim_token_hash = ?, lease_expires_at = ?, processing_note = NULL,
         attempts = attempts + 1, updated_at = ?
     WHERE id IN (
       SELECT id FROM feedback
       WHERE available_at <= ? AND (
         state IN ('pending', 'retry') OR (state = 'claimed' AND lease_expires_at <= ?)
       )
       ORDER BY created_at ASC, id ASC LIMIT ?
     )
     RETURNING id, kind AS category, message, contact_email AS contact, source,
       app_version AS appVersion, catalog_version AS catalogVersion, commit_sha AS commitSha,
       created_at AS createdAt, attempts, lease_expires_at AS leaseExpiresAt`,
  )
    .bind(claimTokenHash, leaseExpiresAt, now, now, now, input.limit)
    .all<ClaimedFeedback>();
  const items = (result.results ?? []).map((item) => ({
    ...item,
    createdAt: new Date(item.createdAt * 1000).toISOString(),
    leaseExpiresAt: new Date(item.leaseExpiresAt * 1000).toISOString(),
    claimToken,
  }));
  return context.json({ items, leaseSeconds: input.leaseSeconds });
});

feedbackRoutes.post("/automation/:feedbackId/:action", async (context) => {
  await requireAutomation(context);
  const feedbackId = feedbackIdSchema.parse(context.req.param("feedbackId"));
  const action = z.enum(["ack", "ignored", "retry"]).parse(context.req.param("action"));
  const input = actionSchema.parse(await readBoundedJson(context));
  const retryReason = input.reason ?? input.error;
  if (action === "retry" && !retryReason)
    throw new HttpError(400, "invalid_request", "Для повтора нужна краткая причина.");
  const now = unixTime();
  const claimTokenHash = await sha256(input.claimToken);
  const state = action === "ack" ? "acknowledged" : action;
  const availableAt = action === "retry" ? now + (input.retryAfterSeconds ?? 300) : now;
  const processedAt = action === "retry" ? null : now;
  const result = await context.env.DB.prepare(
    `UPDATE feedback
     SET state = ?, available_at = ?, claim_token_hash = NULL, lease_expires_at = NULL,
         contact_email = CASE WHEN ? = 'retry' THEN contact_email ELSE NULL END,
         processing_note = ?, processed_at = ?, updated_at = ?
     WHERE id = ? AND state = 'claimed' AND claim_token_hash = ? AND lease_expires_at > ?`,
  )
    .bind(
      state,
      availableAt,
      action,
      action === "retry" ? retryReason : null,
      processedAt,
      now,
      feedbackId,
      claimTokenHash,
      now,
    )
    .run();
  if (Number(result.meta.changes ?? 0) !== 1)
    throw new HttpError(409, "stale_claim", "Обращение уже обработано или аренда истекла.");
  return context.json({ ok: true });
});

export function isFeedbackAutomationPath(path: string): boolean {
  return path.startsWith("/api/feedback/automation/");
}

async function feedbackByRequestId(database: D1Database, requestId: string) {
  return database
    .prepare("SELECT id, payload_hash FROM feedback WHERE request_id = ?")
    .bind(requestId)
    .first<StoredFeedback>();
}

async function requireAutomation(context: Context<{ Bindings: Env }>): Promise<void> {
  const expectedHash = context.env.FEEDBACK_AUTOMATION_TOKEN_SHA256.toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(expectedHash))
    throw new HttpError(503, "automation_not_configured", "Автоматизация не настроена.");
  const authorization = context.req.header("authorization") ?? "";
  const token = /^Bearer\s+([^\s]+)$/iu.exec(authorization)?.[1];
  if (!token) throw new HttpError(401, "automation_unauthorized", "Недостаточно прав.");
  const actualHash = await sha256(token);
  const encoder = new TextEncoder();
  if (!crypto.subtle.timingSafeEqual(encoder.encode(actualHash), encoder.encode(expectedHash)))
    throw new HttpError(401, "automation_unauthorized", "Недостаточно прав.");
}

async function enforceFeedbackRateLimit(context: Context<{ Bindings: Env }>): Promise<void> {
  const address = context.req.header("cf-connecting-ip") ?? "local";
  const bucket = `feedback:${await sha256(address)}`;
  const now = unixTime();
  const row = await context.env.DB.prepare(
    "INSERT INTO rate_limits (bucket, window_started_at, request_count) VALUES (?, ?, 1) ON CONFLICT(bucket) DO UPDATE SET window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END, request_count = CASE WHEN window_started_at <= ? THEN 1 ELSE request_count + 1 END RETURNING request_count",
  )
    .bind(bucket, now, now - 600, now - 600)
    .first<{ request_count: number }>();
  if (!row || row.request_count > 5)
    throw new HttpError(429, "rate_limited", "Слишком много обращений. Повторите позже.");
}

function unixTime(): number {
  return Math.floor(Date.now() / 1000);
}
