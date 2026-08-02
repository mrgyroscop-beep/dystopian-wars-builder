import { describe, expect, it, vi } from "vitest";

import { redactOperationalError } from "./core.mjs";
import { deleteBootstrappedPreviewAfterUpload } from "./cloudflare-api.mjs";

const WORKER = "dwb-pr-5";
const OWNER = "dwb-preview-owner-11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "dwb-preview-owner-22222222-2222-4222-8222-222222222222";
const CREATED_ON = "2026-08-02T00:00:00.000Z";

function workerResource(overrides = {}) {
  return {
    name: WORKER,
    tags: [OWNER],
    created_on: CREATED_ON,
    updated_on: CREATED_ON,
    deployed_on: null,
    subdomain: { enabled: true, previews_enabled: true },
    ...overrides,
  };
}

function scriptRecord(overrides = {}) {
  return { id: WORKER, created_on: CREATED_ON, modified_on: CREATED_ON, ...overrides };
}

function postUploadProvider({
  worker = workerResource(),
  script = scriptRecord(),
  workerInventory,
  scriptInventory,
  leaveAfterDelete,
  mutateDuringInventory,
} = {}) {
  const state = { worker, script, deleteCalls: [] };
  const request = vi.fn(async (pathname, init) => {
    if (pathname === `/workers/scripts/${WORKER}` && init?.method === "DELETE") {
      state.deleteCalls.push(pathname);
      if (leaveAfterDelete !== "resource") state.worker = undefined;
      if (leaveAfterDelete !== "script") state.script = undefined;
      return undefined;
    }
    if (pathname === `/workers/workers/${WORKER}` && init?.method === "DELETE") {
      state.deleteCalls.push(pathname);
      state.worker = undefined;
      state.script = undefined;
      return undefined;
    }
    if (pathname === "/workers/workers") {
      if (workerInventory !== undefined) {
        return typeof workerInventory === "function" ? workerInventory(state) : workerInventory;
      }
      return state.worker ? [structuredClone(state.worker)] : [];
    }
    if (pathname === "/workers/scripts") {
      const result =
        scriptInventory !== undefined
          ? typeof scriptInventory === "function"
            ? scriptInventory(state)
            : scriptInventory
          : state.script
            ? [structuredClone(state.script)]
            : [];
      if (mutateDuringInventory && state.worker) state.worker.tags = [OWNER, OTHER_OWNER];
      return result;
    }
    if (pathname === `/workers/workers/${WORKER}`) {
      return state.worker ? structuredClone(state.worker) : undefined;
    }
    throw new Error("unexpected provider request token=secret account=123");
  });
  return { request, state };
}

async function cleanup(provider) {
  return deleteBootstrappedPreviewAfterUpload({
    name: WORKER,
    prNumber: 5,
    ownershipTag: OWNER,
    request: provider.request,
  });
}

function expectSafeCleanupFailure(error, provider) {
  expect(redactOperationalError(error)).toEqual({
    event: "preview_failure",
    code: "PREVIEW_BOOTSTRAP_FAILED",
    stage: "cleanup-worker",
  });
  expect(JSON.stringify(redactOperationalError(error))).not.toMatch(
    /11111111|22222222|foreign|secret|account|internal|123/i,
  );
  expect(provider.state.deleteCalls).toEqual([]);
}

describe("post-upload bootstrap cleanup", () => {
  it("recovers a committed first upload even when the upload command throws afterward", async () => {
    const provider = postUploadProvider();

    await cleanup(provider);

    expect(provider.state.deleteCalls).toEqual([`/workers/scripts/${WORKER}`]);
    expect(provider.state.worker).toBeUndefined();
    expect(provider.state.script).toBeUndefined();
    expect(
      provider.request.mock.calls
        .slice(-3)
        .map(([pathname]) => pathname)
        .sort(),
    ).toEqual([`/workers/workers/${WORKER}`, "/workers/workers", "/workers/scripts"].sort());
  });

  it("uses unchanged strict standalone cleanup if the script is absent", async () => {
    const provider = postUploadProvider({ script: null });

    await cleanup(provider);

    expect(provider.state.deleteCalls).toEqual([`/workers/workers/${WORKER}`]);
  });

  it("refuses standalone cleanup if a script appears between classification and final proof", async () => {
    let scriptReads = 0;
    const provider = postUploadProvider({
      script: null,
      scriptInventory(state) {
        scriptReads += 1;
        if (scriptReads === 1) return [];
        state.script = scriptRecord();
        return [structuredClone(state.script)];
      },
    });

    const error = await cleanup(provider).catch((value) => value);

    expectSafeCleanupFailure(error, provider);
  });

  it.each([
    ["foreign", [OTHER_OWNER]],
    ["ours plus foreign", [OWNER, OTHER_OWNER]],
    ["duplicate ours", [OWNER, OWNER]],
    ["missing", undefined],
    ["malformed", [null]],
    ["non-array", OWNER],
    ["case variant", [OWNER.toUpperCase()]],
  ])("rejects %s ownership before post-upload cleanup", async (_caseName, tags) => {
    const provider = postUploadProvider();
    provider.state.worker.tags = tags;

    const error = await cleanup(provider).catch((value) => value);

    expectSafeCleanupFailure(error, provider);
  });

  it.each([
    ["name", { name: "dwb-pr-6" }],
    ["deployed state", { deployed_on: CREATED_ON }],
    ["workers.dev flag", { subdomain: { enabled: false, previews_enabled: true } }],
    ["preview URL flag", { subdomain: { enabled: true, previews_enabled: false } }],
  ])("rejects a %s mutation before post-upload cleanup", async (_caseName, mutation) => {
    const provider = postUploadProvider();
    Object.assign(provider.state.worker, mutation);

    const error = await cleanup(provider).catch((value) => value);

    expectSafeCleanupFailure(error, provider);
  });

  it("rejects ownership mutation during inventory reads before the exact final read", async () => {
    const provider = postUploadProvider({ mutateDuringInventory: true });

    const error = await cleanup(provider).catch((value) => value);

    expectSafeCleanupFailure(error, provider);
  });

  it.each([
    ["duplicate resources", { workerInventory: [workerResource(), workerResource()] }],
    ["duplicate scripts", { scriptInventory: [scriptRecord(), scriptRecord()] }],
    ["malformed resources", { workerInventory: { result: "ambiguous" } }],
    ["malformed scripts", { scriptInventory: { result: "ambiguous" } }],
    ["malformed resource entry", { workerInventory: [workerResource(), null] }],
    ["malformed script entry", { scriptInventory: [scriptRecord(), {}] }],
  ])("rejects %s without a destructive request", async (_caseName, options) => {
    const provider = postUploadProvider(options);

    const error = await cleanup(provider).catch((value) => value);

    expectSafeCleanupFailure(error, provider);
  });

  it.each(["resource", "script"])(
    "fails redacted verification when a %s remains after script DELETE",
    async (leaveAfterDelete) => {
      const provider = postUploadProvider({ leaveAfterDelete });

      const error = await cleanup(provider).catch((value) => value);

      expect(redactOperationalError(error)).toEqual({
        event: "preview_failure",
        code: "PREVIEW_BOOTSTRAP_FAILED",
        stage: "cleanup-worker",
      });
      expect(provider.state.deleteCalls).toEqual([`/workers/scripts/${WORKER}`]);
    },
  );

  it.each(["production-worker", "../dwb-pr-5", "dwb-pr-5.example.com", "dwb-pr-0"])(
    "rejects non-preview cleanup target %s before every provider request",
    async (name) => {
      const request = vi.fn();

      await expect(
        deleteBootstrappedPreviewAfterUpload({
          name,
          prNumber: 5,
          ownershipTag: OWNER,
          request,
        }),
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );
});
