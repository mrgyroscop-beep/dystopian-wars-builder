import { z } from "zod";

import type { AuthGateway } from "../../application/auth/auth-contract";

const userSchema = z.object({ id: z.string().uuid(), displayName: z.string().min(1).max(80) });
const sessionSchema = z.object({ user: userSchema.nullable() });

export function createHttpPasswordAuthGateway(fetcher: typeof fetch = fetch): AuthGateway {
  return {
    contractVersion: 1,
    async session(signal) {
      return sessionSchema.parse(
        await request(fetcher, "/api/auth/session", signal ? { signal } : {}),
      ).user;
    },
    async register(email, password, displayName) {
      return authenticatedUser(
        await request(fetcher, "/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, displayName }),
        }),
      );
    },
    async login(email, password) {
      return authenticatedUser(
        await request(fetcher, "/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password }),
        }),
      );
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

function authenticatedUser(payload: unknown) {
  const result = sessionSchema.parse(payload);
  if (!result.user) throw new Error("Не удалось создать сессию.");
  return result.user;
}
