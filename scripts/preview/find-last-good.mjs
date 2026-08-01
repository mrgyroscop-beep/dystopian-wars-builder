import { appendFile } from "node:fs/promises";
import process from "node:process";

import { assertPositiveInteger, redactOperationalError } from "./core.mjs";

try {
  const prNumber = assertPositiveInteger(process.argv[2], "prNumber");
  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  const name = `preview-last-good-pr-${prNumber}`;
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/artifacts?name=${encodeURIComponent(name)}&per_page=10`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${requiredEnvironment("GITHUB_TOKEN")}`,
        "User-Agent": "dystopian-wars-preview",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) throw new Error(`GitHub artifact lookup failed with status ${response.status}`);
  const payload = await response.json();
  const artifact = payload.artifacts?.find(
    (candidate) =>
      !candidate.expired &&
      candidate.name === name &&
      Number.isSafeInteger(candidate.workflow_run?.id),
  );
  await appendFile(
    requiredEnvironment("GITHUB_OUTPUT"),
    artifact ? `found=true\nrun_id=${artifact.workflow_run.id}\n` : "found=false\n",
    "utf8",
  );
  console.log(JSON.stringify({ event: "last_good_lookup", found: Boolean(artifact), prNumber }));
} catch (error) {
  console.error(JSON.stringify(redactOperationalError(error)));
  process.exitCode = 1;
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
