import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { HttpError, randomToken, readBoundedJson, sha256 } from "./http";
import { hashPassword, verifyPassword } from "./password";

const SESSION_COOKIE = "dwb_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/u, "Введите корректный email.");
const passwordSchema = z.string().min(8).max(128);
const registrationSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(80),
  })
  .strict();
const loginSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();
const dummyPassword = {
  salt: "AAAAAAAAAAAAAAAAAAAAAA",
  hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  iterations: 600_000,
};

interface PasswordCredentialRow {
  user_id: string;
  display_name: string;
  password_salt: string;
  password_hash: string;
  password_iterations: number;
}

export interface SessionUser {
  readonly id: string;
  readonly displayName: string;
}

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.get("/session", async (context) => {
  const user = await getSessionUser(context);
  context.header("Cache-Control", "no-store");
  return context.json({ user });
});

authRoutes.post("/register", async (context) => {
  await enforceRateLimit(context, "register", 5, 10 * 60);
  const input = registrationSchema.parse(await readBoundedJson(context));
  const existing = await context.env.DB.prepare(
    "SELECT user_id FROM password_credentials WHERE email = ?",
  )
    .bind(input.email)
    .first();
  if (existing) throw new HttpError(409, "email_exists", "Аккаунт с таким email уже существует.");

  const id = crypto.randomUUID();
  const now = unixTime();
  const password = await hashPassword(input.password);
  const session = await newSession(id, now);
  await context.env.DB.batch([
    context.env.DB.prepare(
      "INSERT INTO users (id, display_name, webauthn_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, input.displayName, `password:${id}`, now, now),
    context.env.DB.prepare(
      "INSERT INTO password_credentials (user_id, email, password_salt, password_hash, password_iterations, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(id, input.email, password.salt, password.hash, password.iterations, now, now),
    context.env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).bind(session.hash, id, session.expiresAt, now),
  ]);
  writeSessionCookie(context, session.token);
  return context.json({ user: { id, displayName: input.displayName } }, 201);
});

authRoutes.post("/login", async (context) => {
  const input = loginSchema.parse(await readBoundedJson(context));
  const rateLimitBucket = await enforceRateLimit(
    context,
    `login:${await sha256(input.email)}`,
    8,
    15 * 60,
  );
  const credential = await context.env.DB.prepare(
    "SELECT pc.user_id, u.display_name, pc.password_salt, pc.password_hash, pc.password_iterations FROM password_credentials pc JOIN users u ON u.id = pc.user_id WHERE pc.email = ?",
  )
    .bind(input.email)
    .first<PasswordCredentialRow>();
  const candidate = credential ?? {
    user_id: "missing",
    display_name: "missing",
    password_salt: dummyPassword.salt,
    password_hash: dummyPassword.hash,
    password_iterations: dummyPassword.iterations,
  };
  const valid = await verifyPassword(
    input.password,
    candidate.password_salt,
    candidate.password_hash,
    candidate.password_iterations,
  );
  if (!credential || !valid)
    throw new HttpError(401, "invalid_credentials", "Неверный email или пароль.");

  const now = unixTime();
  const session = await newSession(credential.user_id, now);
  await context.env.DB.batch([
    context.env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).bind(session.hash, credential.user_id, session.expiresAt, now),
    context.env.DB.prepare("DELETE FROM rate_limits WHERE bucket = ?").bind(rateLimitBucket),
  ]);
  writeSessionCookie(context, session.token);
  return context.json({
    user: { id: credential.user_id, displayName: credential.display_name },
  });
});

authRoutes.post("/logout", async (context) => {
  const token = getCookie(context, SESSION_COOKIE);
  if (token)
    await context.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(await sha256(token))
      .run();
  clearSessionCookie(context);
  return context.json({ ok: true });
});

authRoutes.delete("/account", async (context) => {
  const user = await requireSessionUser(context);
  await context.env.DB.batch([
    context.env.DB.prepare("DELETE FROM roster_revisions WHERE user_id = ?").bind(user.id),
    context.env.DB.prepare("DELETE FROM rosters WHERE user_id = ?").bind(user.id),
    context.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
    context.env.DB.prepare("DELETE FROM password_credentials WHERE user_id = ?").bind(user.id),
    context.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(user.id),
  ]);
  clearSessionCookie(context);
  return context.json({ ok: true });
});

export async function getSessionUser(
  context: Context<{ Bindings: Env }>,
): Promise<SessionUser | null> {
  const token = getCookie(context, SESSION_COOKIE);
  if (!token) return null;
  const row = await context.env.DB.prepare(
    "SELECT u.id, u.display_name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?",
  )
    .bind(await sha256(token), unixTime())
    .first<{ id: string; display_name: string }>();
  return row ? { id: row.id, displayName: row.display_name } : null;
}

export async function requireSessionUser(
  context: Context<{ Bindings: Env }>,
): Promise<SessionUser> {
  const user = await getSessionUser(context);
  if (!user) throw new HttpError(401, "authentication_required", "Сначала войдите в аккаунт.");
  return user;
}

async function enforceRateLimit(
  context: Context<{ Bindings: Env }>,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<string> {
  const address = context.req.header("cf-connecting-ip") ?? "local";
  const bucket = `${action}:${await sha256(address)}`;
  const now = unixTime();
  const row = await context.env.DB.prepare(
    "INSERT INTO rate_limits (bucket, window_started_at, request_count) VALUES (?, ?, 1) ON CONFLICT(bucket) DO UPDATE SET window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END, request_count = CASE WHEN window_started_at <= ? THEN 1 ELSE request_count + 1 END RETURNING request_count",
  )
    .bind(bucket, now, now - windowSeconds, now - windowSeconds)
    .first<{ request_count: number }>();
  if (!row || row.request_count > limit)
    throw new HttpError(429, "rate_limited", "Слишком много попыток. Повторите позже.");
  return bucket;
}

async function newSession(userId: string, now: number) {
  const token = randomToken();
  return {
    token,
    hash: await sha256(token),
    userId,
    expiresAt: now + SESSION_TTL_SECONDS,
  };
}

function writeSessionCookie(context: Context, token: string): void {
  setCookie(context, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

function clearSessionCookie(context: Context): void {
  deleteCookie(context, SESSION_COOKIE, { secure: true, sameSite: "Strict", path: "/" });
}

function unixTime(): number {
  return Math.floor(Date.now() / 1000);
}
