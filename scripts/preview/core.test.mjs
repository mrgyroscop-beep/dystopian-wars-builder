import { describe, expect, it } from "vitest";

import {
  MAX_ARTIFACT_FILE_BYTES,
  MAX_ARTIFACT_FILES,
  MAX_ARTIFACT_TOTAL_BYTES,
  MAX_ACTIVE_PREVIEWS,
  assertAllowlistedWorkerName,
  assertArtifactBounds,
  assertChecksumDocument,
  assertCheckedOutCommit,
  assertCleanTrackedCheckout,
  assertCurrentPullRequest,
  assertManifest,
  assertPreviewCapacity,
  assertPreviewSafeConfig,
  assertTrustedWorkflowRun,
  createManifest,
  planAliasRecovery,
  redactOperationalError,
  selectExpiredPreviewWorkers,
  workerNameForPr,
} from "./core.mjs";

const HEAD_SHA = "a".repeat(40);
const BASE_SHA = "b".repeat(40);
const REPOSITORY = "owner/repository";
const files = [
  { path: "assets/index.html", sha256: "1".repeat(64), size: 100 },
  { path: "worker/index.js", sha256: "2".repeat(64), size: 200 },
];

function trustedRun(overrides = {}) {
  const event = {
    action: "completed",
    workflow_run: {
      id: 123,
      // Observed workflow_run payload shape: no embedded repo.full_name.
      pull_requests: [
        { number: 39, head: { repo: { id: 7, url: "https://api.invalid", name: "repository" } } },
      ],
    },
  };
  const apiRun = {
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
  const currentPullRequest = {
    number: 39,
    state: "open",
    user: { login: "developer" },
    head: { sha: HEAD_SHA, ref: "codex/KAN-39-preview", repo: { full_name: REPOSITORY } },
    base: { sha: BASE_SHA, repo: { full_name: REPOSITORY } },
  };
  return {
    event,
    apiRun,
    currentPullRequest,
    expectedRepository: REPOSITORY,
    ...overrides,
  };
}

function manifest(overrides = {}) {
  return createManifest({
    repository: REPOSITORY,
    headRepository: REPOSITORY,
    prNumber: 39,
    headSha: HEAD_SHA,
    baseSha: BASE_SHA,
    runId: 123,
    createdAt: "2026-08-01T00:00:00.000Z",
    appVersion: "0.1.0",
    catalogVersion: "not-imported",
    nodeVersion: "24.14.0",
    wranglerVersion: "4.118.0",
    configSha256: "3".repeat(64),
    lockfileSha256: "4".repeat(64),
    files,
    ...overrides,
  });
}

describe("preview trust boundary", () => {
  it("accepts API-verified same-repository data despite the observed sparse event payload", () => {
    expect(assertTrustedWorkflowRun(trustedRun())).toEqual({
      runId: 123,
      prNumber: 39,
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
    });
  });

  it("rejects API-resolved forks and stale heads", () => {
    const fork = trustedRun();
    fork.apiRun = { ...fork.apiRun, head_repository: { full_name: "attacker/fork" } };
    expect(() => assertTrustedWorkflowRun(fork)).toThrow(/same-repository/);

    const stale = trustedRun();
    stale.currentPullRequest = {
      ...stale.currentPullRequest,
      head: { ...stale.currentPullRequest.head, sha: "c".repeat(40) },
    };
    expect(() => assertTrustedWorkflowRun(stale)).toThrow(/changed/);
  });

  it.each([
    ["missing", undefined],
    ["malformed", { number: 39, base: { sha: BASE_SHA } }],
    ["zero", []],
    [
      "multiple",
      [
        { number: 39, base: { sha: BASE_SHA } },
        { number: 40, base: { sha: BASE_SHA } },
      ],
    ],
    ["missing PR number", [{ base: { sha: BASE_SHA } }]],
    ["missing base SHA", [{ number: 39, base: {} }]],
  ])("fails closed for %s authenticated workflow-run PR associations", (_name, pullRequests) => {
    const input = trustedRun();
    input.apiRun = { ...input.apiRun, pull_requests: pullRequests };
    expect(() => assertTrustedWorkflowRun(input)).toThrow();
  });

  it.each([
    ["missing run repository", (input) => delete input.apiRun.repository],
    [
      "mismatched run repository",
      (input) => (input.apiRun.repository = { full_name: "attacker/repository" }),
    ],
    ["missing head repository", (input) => delete input.apiRun.head_repository],
    [
      "mismatched current head repository",
      (input) => (input.currentPullRequest.head.repo.full_name = "attacker/repository"),
    ],
    ["missing run head", (input) => delete input.apiRun.head_sha],
    ["mismatched current head", (input) => (input.currentPullRequest.head.sha = "c".repeat(40))],
    ["missing current base", (input) => delete input.currentPullRequest.base],
    [
      "mismatched current base repository",
      (input) => (input.currentPullRequest.base.repo.full_name = "attacker/repository"),
    ],
    [
      "mismatched current base SHA",
      (input) => (input.currentPullRequest.base.sha = "c".repeat(40)),
    ],
    ["in-progress run", (input) => (input.apiRun.status = "in_progress")],
    ["closed current PR", (input) => (input.currentPullRequest.state = "closed")],
  ])("rejects %s", (_name, mutate) => {
    const input = trustedRun();
    mutate(input);
    expect(() => assertTrustedWorkflowRun(input)).toThrow();
  });

  it.each([
    ["failed CI", { conclusion: "failure" }],
    ["wrong event", { event: "push" }],
    ["different workflow", { name: "Attacker CI" }],
  ])("rejects %s API workflow runs", (_name, overrides) => {
    const input = trustedRun();
    input.apiRun = { ...input.apiRun, ...overrides };
    expect(() => assertTrustedWorkflowRun(input)).toThrow();
  });

  it("keeps Dependabot actors and refs CI-only", () => {
    for (const mutation of [
      (input) => (input.apiRun.actor.login = "dependabot[bot]"),
      (input) => (input.currentPullRequest.user.login = "dependabot[bot]"),
      (input) => (input.currentPullRequest.head.ref = "dependabot/npm_and_yarn/react-20"),
    ]) {
      const input = trustedRun();
      mutation(input);
      expect(() => assertTrustedWorkflowRun(input)).toThrow(/Dependabot/);
    }
  });

  it("rejects a synthetic merge checkout attributed to the PR head", () => {
    expect(assertCheckedOutCommit(HEAD_SHA, HEAD_SHA)).toBe(HEAD_SHA);
    expect(() => assertCheckedOutCommit("d".repeat(40), HEAD_SHA)).toThrow(/checked out commit/);
    expect(() => assertCleanTrackedCheckout(" M worker/index.ts\n")).toThrow(/checkout changed/);
    expect(() => assertCleanTrackedCheckout("")).not.toThrow();
  });

  it("rejects a rapidly superseded or closed PR before deployment", () => {
    expect(() =>
      assertCurrentPullRequest(
        {
          number: 39,
          state: "open",
          head: { sha: "c".repeat(40), repo: { full_name: REPOSITORY } },
        },
        { prNumber: 39, headSha: HEAD_SHA, repository: REPOSITORY },
      ),
    ).toThrow(/changed/);
  });
});

describe("preview artifacts", () => {
  it("preserves GitHub run IDs beyond the signed 32-bit range", () => {
    expect(manifest({ runId: 30_698_461_529 }).runId).toBe(30_698_461_529);
  });

  it("binds the manifest to the PR, run and exact commit", () => {
    const value = manifest();
    expect(value.workerName).toBe("dwb-pr-39");
    expect(value.previewAlias).toBe("pr-39");
    expect(value.expiresAt).toBe("2026-08-08T00:00:00.000Z");
    expect(
      assertManifest(value, {
        repository: REPOSITORY,
        headRepository: REPOSITORY,
        prNumber: 39,
        headSha: HEAD_SHA,
        baseSha: BASE_SHA,
        runId: 123,
      }),
    ).toBe(value);
  });

  it("rejects checksum, SHA and path substitution", () => {
    const value = manifest();
    expect(() => assertManifest({ ...value, artifactSha256: "0".repeat(64) }, value)).toThrow();
    expect(() => assertManifest({ ...value, headSha: "c".repeat(40) }, value)).toThrow();
    expect(() =>
      manifest({ files: [...files, { path: "../secret", sha256: "5".repeat(64), size: 1 }] }),
    ).toThrow();
    expect(() =>
      assertChecksumDocument(`${"0".repeat(64)}  worker/index.js\n`, value.files),
    ).toThrow(/checksum/);
  });

  it("rejects excessive file count, individual size and total bytes before hashing", () => {
    expect(() =>
      assertArtifactBounds(
        Array.from({ length: MAX_ARTIFACT_FILES + 1 }, (_, index) => ({
          path: `assets/${index}.js`,
          size: 1,
        })),
      ),
    ).toThrow(/file count/);
    expect(() =>
      assertArtifactBounds([{ path: "worker/index.js", size: MAX_ARTIFACT_FILE_BYTES + 1 }]),
    ).toThrow(/file size/);
    const boundedPart = Math.floor(MAX_ARTIFACT_TOTAL_BYTES / 3) + 1;
    expect(() =>
      assertArtifactBounds([
        { path: "assets/a", size: boundedPart },
        { path: "assets/b", size: boundedPart },
        { path: "assets/c", size: boundedPart },
      ]),
    ).toThrow(/total size/);
  });
});

describe("preview isolation and lifecycle", () => {
  it("plans mutation-safe rollback without resurrecting closed or superseded previews", () => {
    const current = trustedRun().currentPullRequest;
    const expected = { repository: REPOSITORY, prNumber: 39, headSha: HEAD_SHA };
    expect(
      planAliasRecovery({
        mutationStarted: true,
        existedBefore: true,
        hasPreviousArtifact: true,
        currentPullRequest: current,
        expected,
      }),
    ).toBe("restore");
    expect(
      planAliasRecovery({
        mutationStarted: true,
        existedBefore: true,
        hasPreviousArtifact: true,
        currentPullRequest: { ...current, state: "closed" },
        expected,
      }),
    ).toBe("delete");
    expect(
      planAliasRecovery({
        mutationStarted: true,
        existedBefore: true,
        hasPreviousArtifact: true,
        currentPullRequest: {
          ...current,
          head: { ...current.head, sha: "e".repeat(40) },
        },
        expected,
      }),
    ).toBe("skip-stale");
    expect(
      planAliasRecovery({
        mutationStarted: true,
        existedBefore: false,
        hasPreviousArtifact: false,
        currentPullRequest: current,
        expected,
      }),
    ).toBe("delete");
  });
  it("allows only exact per-PR worker names", () => {
    expect(workerNameForPr(7)).toBe("dwb-pr-7");
    expect(assertAllowlistedWorkerName("dwb-pr-7", 7)).toBe("dwb-pr-7");
    for (const unsafe of [
      "dystopian-wars-builder",
      "dwb-pr-7.example.com",
      "../dwb-pr-7",
      "dwb-pr-0",
    ]) {
      expect(() => assertAllowlistedWorkerName(unsafe)).toThrow();
    }
  });

  it("rejects production routes and storage bindings", () => {
    expect(() =>
      assertPreviewSafeConfig('{"workers_dev":true,"preview_urls":true,"routes":["example.com"]}'),
    ).toThrow(/routes/);
    expect(() =>
      assertPreviewSafeConfig('{"workers_dev":true,"preview_urls":true,"d1_databases":[]}'),
    ).toThrow(/d1_databases/);
    expect(() => assertPreviewSafeConfig('{"workers_dev":true,"preview_urls":true}')).not.toThrow();
  });

  it("enforces max previews without blocking an idempotent update", () => {
    const active = Array.from({ length: MAX_ACTIVE_PREVIEWS }, (_, index) => `dwb-pr-${index + 1}`);
    expect(() => assertPreviewCapacity(active, "dwb-pr-21")).toThrow(/limit/);
    expect(() => assertPreviewCapacity(active, "dwb-pr-20")).not.toThrow();
  });

  it("expires only allowlisted previews after seven days", () => {
    expect(
      selectExpiredPreviewWorkers(
        [
          { name: "dwb-pr-1", expiresAt: "2026-08-01T00:00:00Z" },
          { name: "dwb-pr-2", expiresAt: "2026-08-09T00:00:00Z" },
          { name: "production-worker", expiresAt: "2020-01-01T00:00:00Z" },
        ],
        new Date("2026-08-08T00:00:00Z"),
      ),
    ).toEqual(["dwb-pr-1"]);
  });

  it("redacts operational diagnostics to a stable code", () => {
    const error = new Error("C:\\secret\\token Authorization: Bearer abc account=123");
    const record = redactOperationalError(error);
    expect(record).toEqual({ event: "preview_failure", code: "PREVIEW_OPERATION_FAILED" });
    expect(JSON.stringify(record)).not.toMatch(/secret|token|authorization|account|123/i);
  });
});
