import { setTimeout as delay } from "node:timers/promises";

const baseUrl = "https://dystopian-wars-builder.mrgyroscop.workers.dev";
const expectedSha = process.env.RELEASE_SHA;
let releaseReady = false;

for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const health = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    const payload = health.status === 200 ? await health.json() : null;
    if (health.status === 200 && (!expectedSha || payload?.commitSha === expectedSha)) {
      releaseReady = true;
      break;
    }
  } catch {
    // Deployment propagation can briefly reset connections between attempts.
  }
  await delay(5_000);
}

if (!releaseReady) {
  throw new Error("Production did not expose the expected release before the smoke timeout");
}

const response = await fetch(`${baseUrl}/`, {
  redirect: "follow",
  signal: AbortSignal.timeout(10_000),
});

if (response.status !== 200) {
  throw new Error(`Production returned ${response.status}`);
}

const email = `auth-smoke-${crypto.randomUUID()}@example.invalid`;
const password = `smoke-${crypto.randomUUID()}`;
const headers = { "Content-Type": "application/json", Origin: baseUrl };
let sessionCookie = "";
let authFailure;

try {
  const registration = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email, password, displayName: "Production smoke" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (registration.status !== 201) {
    throw new Error(`Production registration returned ${registration.status}`);
  }

  sessionCookie = registration.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  if (!sessionCookie.startsWith("dwb_session=")) {
    throw new Error("Production registration did not create a session cookie");
  }

  const session = await fetch(`${baseUrl}/api/auth/session`, {
    headers: { Cookie: sessionCookie },
    signal: AbortSignal.timeout(10_000),
  });
  const sessionPayload = await session.json();
  if (session.status !== 200 || sessionPayload?.user?.displayName !== "Production smoke") {
    throw new Error(`Production session check returned ${session.status}`);
  }
} catch (error) {
  authFailure = error;
}

if (sessionCookie) {
  try {
    const deletion = await fetch(`${baseUrl}/api/auth/account`, {
      method: "DELETE",
      headers: { ...headers, Cookie: sessionCookie },
      body: "{}",
      signal: AbortSignal.timeout(10_000),
    });
    if (deletion.status !== 200) {
      throw new Error(`Production smoke account cleanup returned ${deletion.status}`);
    }
  } catch (error) {
    authFailure ??= error;
  }
}

if (authFailure) throw authFailure;

console.log("Production and password authentication are online.");
