const [baseUrlArgument, expectedSha] = process.argv.slice(2);

if (!baseUrlArgument || !/^[a-f0-9]{40}$/.test(expectedSha ?? "")) {
  throw new Error("Usage: npm run preview:smoke -- <preview-url> <40-character-sha>");
}

const baseUrl = new URL(baseUrlArgument);
const attempts = 12;

async function request(path) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { Accept: path.startsWith("/api/") ? "application/json" : "text/html" },
    redirect: "follow",
    signal: AbortSignal.timeout(10_000),
  });

  return response;
}

async function verify() {
  const root = await request("/");
  if (root.status !== 200) {
    throw new Error(`Root returned ${root.status}`);
  }

  const health = await request("/api/health");
  const healthPayload = await health.json();
  if (health.status !== 200 || healthPayload.status !== "ok") {
    throw new Error(`Health returned ${health.status}`);
  }
  if (healthPayload.commitSha !== expectedSha) {
    throw new Error("Health commit SHA does not match the preview commit");
  }

  const missing = await request("/api/__preview_smoke_missing");
  const missingPayload = await missing.json();
  if (missing.status !== 404 || missingPayload?.error?.code !== "not_found") {
    throw new Error(`Unknown API route returned ${missing.status}`);
  }
}

let lastError;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    await verify();
    console.log(`Preview smoke passed for ${expectedSha}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }
}

throw lastError;
