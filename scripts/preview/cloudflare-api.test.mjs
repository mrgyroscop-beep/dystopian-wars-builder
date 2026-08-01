import { describe, expect, it, vi } from "vitest";

import { redactOperationalError } from "./core.mjs";
import {
  bootstrapPreviewWorker,
  deleteBootstrappedPreviewWorker,
  ensurePreviewWorkerForUpload,
  listPreviewWorkersForUpload,
} from "./cloudflare-api.mjs";

const WORKER = "dwb-pr-5";
const OWNER = "dwb-preview-owner-11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "dwb-preview-owner-22222222-2222-4222-8222-222222222222";

function workerResource(owner = OWNER, overrides = {}) {
  return {
    name: WORKER,
    tags: [owner],
    deployed_on: null,
    subdomain: { enabled: true, previews_enabled: true },
    ...overrides,
  };
}

function statefulProvider({ loseCreateResponse = false, existingWorker } = {}) {
  const state = {
    worker: existingWorker,
    script: false,
    postCount: 0,
    deleted: false,
  };
  const request = vi.fn(async (pathname, init) => {
    if (pathname === "/workers/workers" && init?.method === "POST") {
      state.postCount += 1;
      if (state.worker) throw new Error("409 provider conflict id=internal");
      const body = JSON.parse(init.body);
      state.worker = workerResource(body.tags[0], { subdomain: body.subdomain });
      if (loseCreateResponse) throw new Error("response lost token=secret account=123");
      return structuredClone(state.worker);
    }
    if (pathname === `/workers/workers/${WORKER}` && init?.method === "DELETE") {
      state.worker = undefined;
      state.script = false;
      state.deleted = true;
      return undefined;
    }
    if (pathname === `/workers/workers/${WORKER}`) {
      return state.worker ? structuredClone(state.worker) : undefined;
    }
    if (pathname === "/workers/workers") {
      return state.worker ? [structuredClone(state.worker)] : [];
    }
    if (pathname === "/workers/scripts") {
      return state.script ? [{ id: WORKER }] : [];
    }
    throw new Error("unexpected provider request");
  });
  return { request, state };
}

describe("preview Worker first-upload ownership", () => {
  it("reconciles and continues when create commits but its response is lost", async () => {
    const provider = statefulProvider({ loseCreateResponse: true });

    await expect(
      bootstrapPreviewWorker({
        name: WORKER,
        prNumber: 5,
        ownershipTag: OWNER,
        request: provider.request,
      }),
    ).resolves.toBe(OWNER);

    expect(provider.state.postCount).toBe(1);
    expect(provider.state.worker.tags).toEqual([OWNER]);
    expect(provider.state.deleted).toBe(false);
    expect(provider.request).toHaveBeenCalledWith(`/workers/workers/${WORKER}`, undefined, true);
    expect(provider.request).toHaveBeenCalledWith("/workers/workers");
    expect(provider.request).toHaveBeenCalledWith("/workers/scripts");
  });

  it("removes the owned standalone resource after lost response and later upload failure", async () => {
    const provider = statefulProvider({ loseCreateResponse: true });
    const owner = await bootstrapPreviewWorker({
      name: WORKER,
      prNumber: 5,
      ownershipTag: OWNER,
      request: provider.request,
    });
    provider.state.script = true;

    await deleteBootstrappedPreviewWorker({
      name: WORKER,
      prNumber: 5,
      ownershipTag: owner,
      request: provider.request,
    });

    expect(provider.state.worker).toBeUndefined();
    expect(provider.state.script).toBe(false);
    expect(provider.state.deleted).toBe(true);
    expect(
      provider.request.mock.calls
        .slice(-3)
        .map(([pathname]) => pathname)
        .sort(),
    ).toEqual([`/workers/workers/${WORKER}`, "/workers/scripts", "/workers/workers"].sort());
  });

  it("never bootstraps an existing Worker", async () => {
    const bootstrap = vi.fn();
    await expect(
      ensurePreviewWorkerForUpload({
        existedBefore: true,
        name: WORKER,
        prNumber: 5,
        bootstrap,
      }),
    ).resolves.toBeUndefined();
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("passes one ownership marker through the absent-worker bootstrap", async () => {
    const bootstrap = vi.fn(async ({ ownershipTag }) => ownershipTag);
    await expect(
      ensurePreviewWorkerForUpload({
        existedBefore: false,
        name: WORKER,
        prNumber: 5,
        ownershipTag: OWNER,
        bootstrap,
      }),
    ).resolves.toBe(OWNER);
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(bootstrap).toHaveBeenCalledWith({
      name: WORKER,
      prNumber: 5,
      ownershipTag: OWNER,
    });
  });

  it("fails closed on a different-owner race and never deletes or overwrites it", async () => {
    const provider = statefulProvider({ existingWorker: workerResource(OTHER_OWNER) });

    const error = await bootstrapPreviewWorker({
      name: WORKER,
      prNumber: 5,
      ownershipTag: OWNER,
      request: provider.request,
    }).catch((value) => value);

    expect(redactOperationalError(error)).toEqual({
      event: "preview_failure",
      code: "PREVIEW_BOOTSTRAP_FAILED",
      stage: "reconcile-worker",
    });
    expect(provider.state.worker.tags).toEqual([OTHER_OWNER]);
    expect(provider.state.deleted).toBe(false);
    expect(provider.state.postCount).toBe(1);
  });

  it("idempotently reconciles a retry carrying the same ownership tag", async () => {
    const provider = statefulProvider({ existingWorker: workerResource(OWNER) });

    await expect(
      bootstrapPreviewWorker({
        name: WORKER,
        prNumber: 5,
        ownershipTag: OWNER,
        request: provider.request,
      }),
    ).resolves.toBe(OWNER);
    expect(provider.state.deleted).toBe(false);
  });

  it("retries only fresh reconciliation reads, never the create mutation", async () => {
    const provider = statefulProvider({ loseCreateResponse: true });
    let exactReads = 0;
    const request = vi.fn(async (...arguments_) => {
      if (arguments_[0] === `/workers/workers/${WORKER}` && arguments_[1] === undefined) {
        exactReads += 1;
        if (exactReads === 1) return undefined;
      }
      return provider.request(...arguments_);
    });

    await expect(
      bootstrapPreviewWorker({
        name: WORKER,
        prNumber: 5,
        ownershipTag: OWNER,
        request,
        wait: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBe(OWNER);
    expect(provider.state.postCount).toBe(1);
    expect(exactReads).toBe(2);
  });

  it("retries a transient reconciliation read failure without repeating create", async () => {
    const provider = statefulProvider({ loseCreateResponse: true });
    let exactReads = 0;
    const request = vi.fn(async (...arguments_) => {
      if (arguments_[0] === `/workers/workers/${WORKER}` && arguments_[1] === undefined) {
        exactReads += 1;
        if (exactReads === 1) throw new Error("transient provider response internal-id=123");
      }
      return provider.request(...arguments_);
    });

    await expect(
      bootstrapPreviewWorker({
        name: WORKER,
        prNumber: 5,
        ownershipTag: OWNER,
        request,
        wait: vi.fn().mockResolvedValue(undefined),
      }),
    ).resolves.toBe(OWNER);
    expect(provider.state.postCount).toBe(1);
    expect(exactReads).toBe(2);
  });

  it("deletes an owned but invalid empty resource and reports only a safe stage", async () => {
    const provider = statefulProvider();
    const originalRequest = provider.request;
    provider.request = vi.fn(async (...arguments_) => {
      const result = await originalRequest(...arguments_);
      if (arguments_[0] === "/workers/workers" && arguments_[1]?.method === "POST") {
        provider.state.worker.subdomain.previews_enabled = false;
      }
      return result;
    });

    const error = await bootstrapPreviewWorker({
      name: WORKER,
      prNumber: 5,
      ownershipTag: OWNER,
      request: provider.request,
    }).catch((value) => value);
    expect(redactOperationalError(error)).toEqual({
      event: "preview_failure",
      code: "PREVIEW_BOOTSTRAP_FAILED",
      stage: "configure-subdomain",
    });
    expect(provider.state.worker).toBeUndefined();
    expect(provider.state.deleted).toBe(true);
  });

  it("refuses cleanup when fresh ownership proof does not match", async () => {
    const provider = statefulProvider({ existingWorker: workerResource(OTHER_OWNER) });
    await expect(
      deleteBootstrappedPreviewWorker({
        name: WORKER,
        prNumber: 5,
        ownershipTag: OWNER,
        request: provider.request,
      }),
    ).rejects.toMatchObject({ code: "PREVIEW_BOOTSTRAP_FAILED", stage: "cleanup-worker" });
    expect(provider.state.deleted).toBe(false);
    expect(provider.state.worker.tags).toEqual([OTHER_OWNER]);
  });

  it.each(["resource", "script"])(
    "fails cleanup verification while an owned %s orphan remains",
    async (orphanKind) => {
      const provider = statefulProvider({ existingWorker: workerResource(OWNER) });
      const originalRequest = provider.request;
      provider.request = vi.fn(async (...arguments_) => {
        const result = await originalRequest(...arguments_);
        if (arguments_[0] === `/workers/workers/${WORKER}` && arguments_[1]?.method === "DELETE") {
          if (orphanKind === "resource") provider.state.worker = workerResource(OWNER);
          if (orphanKind === "script") provider.state.script = true;
        }
        return result;
      });

      await expect(
        deleteBootstrappedPreviewWorker({
          name: WORKER,
          prNumber: 5,
          ownershipTag: OWNER,
          request: provider.request,
        }),
      ).rejects.toMatchObject({ code: "PREVIEW_BOOTSTRAP_FAILED", stage: "cleanup-worker" });
    },
  );

  it("redacts a failed create whose reconciliation proves no owned resource", async () => {
    const request = vi.fn(async (pathname, init) => {
      if (pathname === "/workers/workers" && init?.method === "POST") {
        throw new Error("provider token=secret account=123 path=C:\\private");
      }
      if (pathname === `/workers/workers/${WORKER}`) return undefined;
      if (pathname === "/workers/workers" || pathname === "/workers/scripts") return [];
      throw new Error("unexpected provider request");
    });

    const error = await bootstrapPreviewWorker({
      name: WORKER,
      prNumber: 5,
      ownershipTag: OWNER,
      request,
      wait: vi.fn().mockResolvedValue(undefined),
    }).catch((value) => value);
    expect(redactOperationalError(error)).toEqual({
      event: "preview_failure",
      code: "PREVIEW_BOOTSTRAP_FAILED",
      stage: "reconcile-worker",
    });
    expect(JSON.stringify(redactOperationalError(error))).not.toMatch(
      /secret|account|private|internal|123/i,
    );
  });

  it("preflight includes both standalone Worker resources and scripts", async () => {
    const request = vi.fn(async (pathname) => {
      if (pathname === "/workers/workers") return [workerResource(OWNER)];
      if (pathname === "/workers/scripts") return [{ id: "dwb-pr-6" }];
      throw new Error("unexpected request");
    });
    await expect(listPreviewWorkersForUpload(WORKER, 5, request)).resolves.toEqual([
      "dwb-pr-5",
      "dwb-pr-6",
    ]);
  });

  it.each(["production-worker", "../dwb-pr-5", "dwb-pr-5.example.com", "dwb-pr-0"])(
    "rejects non-preview target %s before every provider request",
    async (name) => {
      const request = vi.fn();
      await expect(
        bootstrapPreviewWorker({
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
