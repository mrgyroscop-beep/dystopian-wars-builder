import { describe, expect, it, vi } from "vitest";

import { redactOperationalError } from "./core.mjs";
import {
  bootstrapPreviewWorker,
  deleteBootstrappedPreviewWorker,
  ensurePreviewWorkerForUpload,
} from "./cloudflare-api.mjs";

const WORKER = "dwb-pr-5";

describe("preview Worker first-upload bootstrap", () => {
  it("atomically creates only an empty allowlisted Worker with both workers.dev URL modes", async () => {
    const calls = [];
    const request = vi.fn(async (pathname, init) => {
      calls.push({ pathname, init });
      if (pathname === "/workers/workers") {
        return {
          name: WORKER,
          deployed_on: null,
          subdomain: { enabled: true, previews_enabled: true },
        };
      }
      throw new Error("unexpected request");
    });

    await expect(bootstrapPreviewWorker(WORKER, 5, request)).resolves.toBeUndefined();
    expect(calls).toEqual([
      {
        pathname: "/workers/workers",
        init: {
          method: "POST",
          body: JSON.stringify({
            name: WORKER,
            subdomain: { enabled: true, previews_enabled: true },
          }),
        },
      },
    ]);
  });

  it("never bootstraps or overwrites an existing preview Worker", async () => {
    const bootstrap = vi.fn();
    await expect(
      ensurePreviewWorkerForUpload({
        existedBefore: true,
        name: WORKER,
        prNumber: 5,
        bootstrap,
      }),
    ).resolves.toBe(false);
    expect(bootstrap).not.toHaveBeenCalled();
  });

  it("bootstraps an absent Worker exactly once", async () => {
    const bootstrap = vi.fn().mockResolvedValue(undefined);
    await expect(
      ensurePreviewWorkerForUpload({
        existedBefore: false,
        name: WORKER,
        prNumber: 5,
        bootstrap,
      }),
    ).resolves.toBe(true);
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(bootstrap).toHaveBeenCalledWith(WORKER, 5);
  });

  it("fails closed on create failure or a create race without touching the raced Worker", async () => {
    for (const providerMessage of [
      "provider status=500 token=secret account=123 path=C:\\private",
      "409 worker already exists id=provider-internal-id",
    ]) {
      const request = vi.fn().mockRejectedValue(new Error(providerMessage));
      const error = await bootstrapPreviewWorker(WORKER, 5, request).catch((value) => value);
      expect(redactOperationalError(error)).toEqual({
        event: "preview_failure",
        code: "PREVIEW_BOOTSTRAP_FAILED",
        stage: "create-worker",
      });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith("/workers/workers", {
        method: "POST",
        body: JSON.stringify({
          name: WORKER,
          subdomain: { enabled: true, previews_enabled: true },
        }),
      });
      expect(JSON.stringify(redactOperationalError(error))).not.toMatch(
        /secret|account|private|internal|123|500|409/i,
      );
    }
  });

  it("deletes its own empty resource if subdomain configuration fails", async () => {
    const calls = [];
    const request = vi.fn(async (pathname, init, acceptNotFound) => {
      calls.push({ pathname, init, acceptNotFound });
      if (pathname === "/workers/workers" && init?.method === "POST") {
        return {
          name: WORKER,
          subdomain: { enabled: false, previews_enabled: false },
        };
      }
      if (pathname === `/workers/workers/${WORKER}` && init?.method === "DELETE") return undefined;
      if (pathname === "/workers/workers") return [];
      if (pathname === "/workers/scripts") return [];
      throw new Error("unexpected request");
    });

    const error = await bootstrapPreviewWorker(WORKER, 5, request).catch((value) => value);
    expect(redactOperationalError(error)).toEqual({
      event: "preview_failure",
      code: "PREVIEW_BOOTSTRAP_FAILED",
      stage: "configure-subdomain",
    });
    expect(calls.at(-3)).toEqual({
      pathname: `/workers/workers/${WORKER}`,
      init: { method: "DELETE" },
      acceptNotFound: true,
    });
    expect(
      calls
        .slice(-2)
        .map((call) => call.pathname)
        .sort(),
    ).toEqual(["/workers/scripts", "/workers/workers"]);
  });

  it("reports a safe cleanup stage if recovery of its empty resource fails", async () => {
    const request = vi.fn(async (pathname) => {
      if (pathname === "/workers/workers") {
        return {
          name: WORKER,
          subdomain: { enabled: false, previews_enabled: false },
        };
      }
      throw new Error("provider stderr C:\\secret token=abc account=123 id=456");
    });

    const error = await bootstrapPreviewWorker(WORKER, 5, request).catch((value) => value);
    expect(redactOperationalError(error)).toEqual({
      event: "preview_failure",
      code: "PREVIEW_BOOTSTRAP_FAILED",
      stage: "cleanup-worker",
    });
  });

  it.each([
    ["Worker resource", [{ name: WORKER }], []],
    ["legacy script", [], [{ id: WORKER }]],
  ])("fails cleanup verification while a %s orphan remains", async (_name, resources, scripts) => {
    const request = vi.fn(async (pathname, init) => {
      if (pathname === `/workers/workers/${WORKER}` && init?.method === "DELETE") return undefined;
      if (pathname === "/workers/workers") return resources;
      if (pathname === "/workers/scripts") return scripts;
      throw new Error("unexpected request");
    });

    await expect(deleteBootstrappedPreviewWorker(WORKER, 5, request)).rejects.toMatchObject({
      code: "PREVIEW_BOOTSTRAP_FAILED",
      stage: "cleanup-worker",
    });
  });

  it.each(["production-worker", "../dwb-pr-5", "dwb-pr-5.example.com", "dwb-pr-0"])(
    "rejects non-preview target %s before any provider request",
    async (name) => {
      const request = vi.fn();
      await expect(bootstrapPreviewWorker(name, 5, request)).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );
});
