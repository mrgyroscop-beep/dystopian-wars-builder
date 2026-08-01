import { appendFile, readFile, writeFile } from "node:fs/promises";
import process from "node:process";

import {
  assertPositiveInteger,
  assertTrustedWorkflowRun,
  redactOperationalError,
} from "./core.mjs";

try {
  const event = JSON.parse(await readFile(requiredEnvironment("GITHUB_EVENT_PATH"), "utf8"));
  const repository = requiredEnvironment("GITHUB_REPOSITORY");
  const runId = assertPositiveInteger(event?.workflow_run?.id, "event.workflowRunId");
  const apiRun = await githubRequest(`/repos/${repository}/actions/runs/${runId}`);
  const associatedPullRequests = await githubRequest(
    `/repos/${repository}/actions/runs/${runId}/pull_requests`,
  );
  if (!Array.isArray(associatedPullRequests) || associatedPullRequests.length !== 1) {
    throw new Error("Workflow run must resolve to exactly one pull request");
  }
  const currentPullRequest = await githubRequest(
    `/repos/${repository}/pulls/${associatedPullRequests[0].number}`,
  );
  const trusted = assertTrustedWorkflowRun({
    event,
    apiRun,
    associatedPullRequests,
    currentPullRequest,
    expectedRepository: repository,
  });

  const output = {
    repository,
    headRepository: repository,
    ...trusted,
  };
  await writeFile(
    process.argv[2] ?? "artifacts/preview/trusted-event.json",
    `${JSON.stringify(output)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `run_id=${trusted.runId}\npr_number=${trusted.prNumber}\nhead_sha=${trusted.headSha}\n`,
      "utf8",
    );
  }
  console.log(
    JSON.stringify({
      event: "trusted_preview_run",
      prNumber: trusted.prNumber,
      headSha: trusted.headSha,
    }),
  );
} catch (error) {
  console.error(JSON.stringify(redactOperationalError(error)));
  process.exitCode = 1;
}

async function githubRequest(pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${requiredEnvironment("GITHUB_TOKEN")}`,
      "User-Agent": "dystopian-wars-preview",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub request failed with status ${response.status}`);
  return response.json();
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
