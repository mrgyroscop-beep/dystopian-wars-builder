import { describe, expect, it, vi } from "vitest";

import { resolveTrustedWorkflowRun } from "./resolve-trusted-run-core.mjs";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const REPOSITORY = "owner/repository";

function workflowRun() {
  return {
    id: 123,
    name: "CI",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    head_sha: HEAD_SHA,
    repository: { full_name: REPOSITORY },
    head_repository: { full_name: REPOSITORY },
    actor: { login: "developer" },
    pull_requests: [{ number: 39, base: { sha: BASE_SHA } }],
  };
}

function pullRequest() {
  return {
    number: 39,
    state: "open",
    user: { login: "developer" },
    head: { sha: HEAD_SHA, ref: "codex/KAN-39-preview", repo: { full_name: REPOSITORY } },
    base: { sha: BASE_SHA, repo: { full_name: REPOSITORY } },
  };
}

describe("trusted workflow-run resolution", () => {
  it("uses the authenticated run's embedded PR list and never calls the live-404 endpoint", async () => {
    const calls = [];
    const request = vi.fn(async (pathname) => {
      calls.push(pathname);
      if (pathname.endsWith("/pull_requests")) {
        throw new Error("GitHub live endpoint returned 404");
      }
      if (pathname === `/repos/${REPOSITORY}/actions/runs/123`) return workflowRun();
      if (pathname === `/repos/${REPOSITORY}/pulls/39`) return pullRequest();
      throw new Error(`Unexpected request: ${pathname}`);
    });

    await expect(
      resolveTrustedWorkflowRun({
        event: { action: "completed", workflow_run: { id: 123 } },
        repository: REPOSITORY,
        request,
      }),
    ).resolves.toEqual({
      runId: 123,
      prNumber: 39,
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
    });
    expect(calls).toEqual([
      `/repos/${REPOSITORY}/actions/runs/123`,
      `/repos/${REPOSITORY}/pulls/39`,
    ]);
  });

  it.each([
    ["no association", []],
    [
      "ambiguous associations",
      [
        { number: 39, base: { sha: BASE_SHA } },
        { number: 40, base: { sha: BASE_SHA } },
      ],
    ],
    ["malformed association", [{ base: { sha: BASE_SHA } }]],
  ])("fails before the fresh PR request for %s", async (_name, pullRequests) => {
    const apiRun = { ...workflowRun(), pull_requests: pullRequests };
    const request = vi.fn(async (pathname) => {
      if (pathname === `/repos/${REPOSITORY}/actions/runs/123`) return apiRun;
      throw new Error(`Unexpected request: ${pathname}`);
    });

    await expect(
      resolveTrustedWorkflowRun({
        event: { action: "completed", workflow_run: { id: 123 } },
        repository: REPOSITORY,
        request,
      }),
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
