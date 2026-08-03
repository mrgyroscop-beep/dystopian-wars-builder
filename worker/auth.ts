import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { Hono, type Context } from "hono";
import { z } from "zod";

import { HttpError, randomToken, readBoundedJson, sha256 } from "./http";

const SESSION_COOKIE = "dwb_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const CHALLENGE_TTL_SECONDS = 5 * 60;
const rpName = "Dystopian Wars Fleet Builder";
const base64Url = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/u)
  .max(4096);
const transports = z.array(
  z.enum(["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"]),
);
const registrationResponseSchema = z
  .object({
    id: base64Url,
    rawId: base64Url,
    response: z
      .object({
        clientDataJSON: base64Url,
        attestationObject: base64Url,
        authenticatorData: base64Url.optional(),
        transports: transports.optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        publicKey: base64Url.optional(),
      })
      .strict(),
    authenticatorAttachment: z.enum(["cross-platform", "platform"]).optional(),
    clientExtensionResults: z.record(z.string(), z.unknown()),
    type: z.literal("public-key"),
  })
  .strict();
const authenticationResponseSchema = z
  .object({
    id: base64Url,
    rawId: base64Url,
    response: z
      .object({
        clientDataJSON: base64Url,
        authenticatorData: base64Url,
        signature: base64Url,
        userHandle: base64Url.optional(),
      })
      .strict(),
    authenticatorAttachment: z.enum(["cross-platform", "platform"]).optional(),
    clientExtensionResults: z.record(z.string(), z.unknown()),
    type: z.literal("public-key"),
  })
  .strict();

interface ChallengeRow {
  challenge: string;
  payload: string;
}

interface PasskeyRow {
  credential_id: string;
  user_id: string;
  public_key: ArrayBuffer;
  counter: number;
  transports: string;
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

authRoutes.post("/passkey/register/options", async (context) => {
  await enforceRateLimit(context, "register", 5, 10 * 60);
  const input = z
    .object({ displayName: z.string().trim().min(1).max(80) })
    .strict()
    .parse(await readBoundedJson(context));
  const userId = crypto.randomUUID();
  const options = await generateRegistrationOptions({
    rpName,
    rpID: new URL(context.req.url).hostname,
    userName: input.displayName,
    userDisplayName: input.displayName,
    userID: Uint8Array.from(new TextEncoder().encode(userId)),
    attestationType: "none",
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
    supportedAlgorithmIDs: [-7, -257],
  });
  const transactionId = randomToken();
  const now = unixTime();
  await context.env.DB.prepare(
    "INSERT INTO auth_challenges (transaction_hash, purpose, challenge, payload, expires_at, created_at) VALUES (?, 'register', ?, ?, ?, ?)",
  )
    .bind(
      await sha256(transactionId),
      options.challenge,
      JSON.stringify({ userId, displayName: input.displayName, webauthnUserId: options.user.id }),
      now + CHALLENGE_TTL_SECONDS,
      now,
    )
    .run();
  return context.json({ transactionId, options });
});

authRoutes.post("/passkey/register/verify", async (context) => {
  const input = z
    .object({ transactionId: base64Url, response: registrationResponseSchema })
    .strict()
    .parse(await readBoundedJson(context));
  const transactionHash = await sha256(input.transactionId);
  const response: unknown = input.response;
  if (!isRegistrationResponse(response))
    throw new HttpError(400, "invalid_passkey", "Passkey response is invalid.");
  const challenge = await readChallenge(context.env.DB, transactionHash, "register");
  await context.env.DB.prepare("DELETE FROM auth_challenges WHERE transaction_hash = ?")
    .bind(transactionHash)
    .run();
  const payload = z
    .object({
      userId: z.string().uuid(),
      displayName: z.string().min(1).max(80),
      webauthnUserId: base64Url,
    })
    .strict()
    .parse(JSON.parse(challenge.payload));
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: new URL(context.req.url).origin,
    expectedRPID: new URL(context.req.url).hostname,
    requireUserVerification: true,
  });
  if (!verification.verified || !verification.registrationInfo)
    throw new HttpError(400, "invalid_passkey", "Passkey registration could not be verified.");

  const now = unixTime();
  const session = await newSession(payload.userId, now);
  const credential = verification.registrationInfo.credential;
  await context.env.DB.batch([
    context.env.DB.prepare(
      "INSERT INTO users (id, display_name, webauthn_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(payload.userId, payload.displayName, payload.webauthnUserId, now, now),
    context.env.DB.prepare(
      "INSERT INTO passkeys (credential_id, user_id, public_key, counter, device_type, backed_up, transports, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(
      credential.id,
      payload.userId,
      credential.publicKey,
      credential.counter,
      verification.registrationInfo.credentialDeviceType,
      verification.registrationInfo.credentialBackedUp ? 1 : 0,
      JSON.stringify(credential.transports ?? []),
      now,
    ),
    context.env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).bind(session.hash, payload.userId, session.expiresAt, now),
    context.env.DB.prepare("DELETE FROM auth_challenges WHERE transaction_hash = ?").bind(
      transactionHash,
    ),
  ]);
  writeSessionCookie(context, session.token);
  return context.json({ user: { id: payload.userId, displayName: payload.displayName } }, 201);
});

authRoutes.post("/passkey/login/options", async (context) => {
  await enforceRateLimit(context, "login", 20, 10 * 60);
  const options = await generateAuthenticationOptions({
    rpID: new URL(context.req.url).hostname,
    userVerification: "required",
  });
  const transactionId = randomToken();
  const now = unixTime();
  await context.env.DB.prepare(
    "INSERT INTO auth_challenges (transaction_hash, purpose, challenge, payload, expires_at, created_at) VALUES (?, 'login', ?, '{}', ?, ?)",
  )
    .bind(await sha256(transactionId), options.challenge, now + CHALLENGE_TTL_SECONDS, now)
    .run();
  return context.json({ transactionId, options });
});

authRoutes.post("/passkey/login/verify", async (context) => {
  const input = z
    .object({ transactionId: base64Url, response: authenticationResponseSchema })
    .strict()
    .parse(await readBoundedJson(context));
  const transactionHash = await sha256(input.transactionId);
  const response: unknown = input.response;
  if (!isAuthenticationResponse(response))
    throw new HttpError(400, "invalid_passkey", "Passkey response is invalid.");
  const challenge = await readChallenge(context.env.DB, transactionHash, "login");
  await context.env.DB.prepare("DELETE FROM auth_challenges WHERE transaction_hash = ?")
    .bind(transactionHash)
    .run();
  const passkey = await context.env.DB.prepare(
    "SELECT credential_id, user_id, public_key, counter, transports FROM passkeys WHERE credential_id = ?",
  )
    .bind(input.response.id)
    .first<PasskeyRow>();
  if (!passkey) throw new HttpError(401, "invalid_passkey", "Passkey is not registered.");
  const parsedTransports = transports.parse(JSON.parse(passkey.transports));
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: new URL(context.req.url).origin,
    expectedRPID: new URL(context.req.url).hostname,
    requireUserVerification: true,
    credential: {
      id: passkey.credential_id,
      publicKey: new Uint8Array(passkey.public_key),
      counter: passkey.counter,
      transports: parsedTransports satisfies AuthenticatorTransportFuture[],
    },
  });
  if (!verification.verified)
    throw new HttpError(401, "invalid_passkey", "Passkey authentication failed.");
  const now = unixTime();
  const session = await newSession(passkey.user_id, now);
  await context.env.DB.batch([
    context.env.DB.prepare("UPDATE passkeys SET counter = ? WHERE credential_id = ?").bind(
      verification.authenticationInfo.newCounter,
      passkey.credential_id,
    ),
    context.env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).bind(session.hash, passkey.user_id, session.expiresAt, now),
    context.env.DB.prepare("DELETE FROM auth_challenges WHERE transaction_hash = ?").bind(
      transactionHash,
    ),
  ]);
  const user = await context.env.DB.prepare("SELECT id, display_name FROM users WHERE id = ?")
    .bind(passkey.user_id)
    .first<{ id: string; display_name: string }>();
  if (!user) throw new HttpError(401, "invalid_session", "Account no longer exists.");
  writeSessionCookie(context, session.token);
  return context.json({ user: { id: user.id, displayName: user.display_name } });
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
    context.env.DB.prepare("DELETE FROM passkeys WHERE user_id = ?").bind(user.id),
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
  if (!user) throw new HttpError(401, "authentication_required", "Sign in is required.");
  return user;
}

async function readChallenge(
  database: D1Database,
  transactionHash: string,
  purpose: "register" | "login",
): Promise<ChallengeRow> {
  const row = await database
    .prepare(
      "SELECT challenge, payload FROM auth_challenges WHERE transaction_hash = ? AND purpose = ? AND expires_at > ?",
    )
    .bind(transactionHash, purpose, unixTime())
    .first<ChallengeRow>();
  if (!row) throw new HttpError(401, "expired_challenge", "Authentication request expired.");
  return row;
}

async function enforceRateLimit(
  context: Context<{ Bindings: Env }>,
  action: string,
  limit: number,
  windowSeconds: number,
): Promise<void> {
  const address = context.req.header("cf-connecting-ip") ?? "local";
  const bucket = `${action}:${await sha256(address)}`;
  const now = unixTime();
  const row = await context.env.DB.prepare(
    "INSERT INTO rate_limits (bucket, window_started_at, request_count) VALUES (?, ?, 1) ON CONFLICT(bucket) DO UPDATE SET window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END, request_count = CASE WHEN window_started_at <= ? THEN 1 ELSE request_count + 1 END RETURNING window_started_at, request_count",
  )
    .bind(bucket, now, now - windowSeconds, now - windowSeconds)
    .first<{ window_started_at: number; request_count: number }>();
  if (!row || row.request_count > limit)
    throw new HttpError(429, "rate_limited", "Too many authentication attempts.");
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

function isRegistrationResponse(value: unknown): value is RegistrationResponseJSON {
  return registrationResponseSchema.safeParse(value).success;
}

function isAuthenticationResponse(value: unknown): value is AuthenticationResponseJSON {
  return authenticationResponseSchema.safeParse(value).success;
}
