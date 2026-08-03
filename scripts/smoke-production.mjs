const baseUrl = "https://dystopian-wars-builder.mrgyroscop.workers.dev";
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
