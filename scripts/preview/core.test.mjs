import { describe, expect, it } from "vitest";

import {
  MAX_ACTIVE_PREVIEWS,
  assertAllowlistedWorkerName,
  assertChecksumDocument,
  assertCurrentPullRequest,
  assertManifest,
  assertPreviewCapacity,
  assertPreviewSafeConfig,
  assertTrustedWorkflowRun,
  createManifest,
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

function trustedEvent(overrides = {}) {
  return {
    action: "completed",
    workflow_run: {
      id: 123,
      name: "CI",
      conclusion: "success",
      head_sha: HEAD_SHA,
      repository: { full_name: REPOSITORY },
      head_repository: { full_name: REPOSITORY },
      pull_requests: [
        {
          number: 39,
          head: { sha: HEAD_SHA, repo: { full_name: REPOSITORY } },
          base: { sha: BASE_SHA },
        },
      ],
      ...overrides,
    },
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
  it("accepts a successful same-repository exact-head CI run", () => {
    expect(assertTrustedWorkflowRun(trustedEvent(), REPOSITORY)).toEqual({
      runId: 123,
      prNumber: 39,
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
    });
  });

  it.each([
    ["fork", { head_repository: { full_name: "attacker/fork" } }],
    ["failed CI", { conclusion: "failure" }],
    ["missing PR", { pull_requests: [] }],
    ["different workflow", { name: "Attacker CI" }],
  ])("rejects %s workflow runs", (_name, overrides) => {
    expect(() => assertTrustedWorkflowRun(trustedEvent(overrides), REPOSITORY)).toThrow();
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
});

describe("preview isolation and lifecycle", () => {
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
