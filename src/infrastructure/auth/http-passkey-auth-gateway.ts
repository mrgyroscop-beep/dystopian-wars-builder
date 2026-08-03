import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { z } from "zod";

import type { AuthGateway } from "../../application/auth/auth-contract";

const userSchema = z.object({ id: z.string().uuid(), displayName: z.string().min(1).max(80) });
const sessionSchema = z.object({ user: userSchema.nullable() });

export function createHttpPasskeyAuthGateway(fetcher: typeof fetch = fetch): AuthGateway {
  return {
    contractVersion: 1,
    async session(signal) {
      return sessionSchema.parse(
        await request(fetcher, "/api/auth/session", signal ? { signal } : {}),
      ).user;
    },
    async register(displayName) {
      const transaction = await request(fetcher, "/api/auth/passkey/register/options", {
        method: "POST",
        body: JSON.stringify({ displayName }),
      });
      if (!isRegistrationTransaction(transaction))
        throw new Error("Сервер вернул некорректные параметры passkey.");
      const response = await startRegistration({ optionsJSON: transaction.options });
      const result = sessionSchema.parse(
        await request(fetcher, "/api/auth/passkey/register/verify", {
          method: "POST",
          body: JSON.stringify({ transactionId: transaction.transactionId, response }),
        }),
      );
      if (!result.user) throw new Error("Не удалось создать сессию.");
      return result.user;
    },
    async login() {
      const transaction = await request(fetcher, "/api/auth/passkey/login/options", {
        method: "POST",
        body: "{}",
      });
      if (!isAuthenticationTransaction(transaction))
        throw new Error("Сервер вернул некорректные параметры входа.");
      const response = await startAuthentication({ optionsJSON: transaction.options });
      const result = sessionSchema.parse(
        await request(fetcher, "/api/auth/passkey/login/verify", {
          method: "POST",
          body: JSON.stringify({ transactionId: transaction.transactionId, response }),
        }),
      );
      if (!result.user) throw new Error("Не удалось восстановить сессию.");
      return result.user;
    },
    async logout() {
      await request(fetcher, "/api/auth/logout", { method: "POST", body: "{}" });
    },
    async deleteAccount() {
      await request(fetcher, "/api/auth/account", { method: "DELETE", body: "{}" });
    },
  };
}

async function request(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
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

function isRegistrationTransaction(
  value: unknown,
): value is { transactionId: string; options: PublicKeyCredentialCreationOptionsJSON } {
  if (!isRecord(value) || typeof value.transactionId !== "string" || !isRecord(value.options))
    return false;
  const options = value.options;
  return (
    typeof options.challenge === "string" &&
    isRecord(options.rp) &&
    typeof options.rp.name === "string" &&
    isRecord(options.user) &&
    typeof options.user.id === "string" &&
    typeof options.user.name === "string" &&
    typeof options.user.displayName === "string" &&
    Array.isArray(options.pubKeyCredParams)
  );
}

function isAuthenticationTransaction(
  value: unknown,
): value is { transactionId: string; options: PublicKeyCredentialRequestOptionsJSON } {
  return (
    isRecord(value) &&
    typeof value.transactionId === "string" &&
    isRecord(value.options) &&
    typeof value.options.challenge === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
