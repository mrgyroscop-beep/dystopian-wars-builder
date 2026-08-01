import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchLockedSources } from "./fetch-sources.mjs";

const temporary = [];
afterEach(async () =>
  Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe("bounded source fetch", () => {
  it("uses an exact immutable URL, verifies bytes, and then uses cache", async () => {
    const body = Buffer.from('<gameSystem id="sys" name="Game" revision="1"/>');
    const lock = makeLock(body);
    const fetchImpl = vi.fn(async (url) => {
      expect(url.toString()).toBe(
        "https://raw.githubusercontent.com/Nord0rk/Dystopian-Wars-4.0/" +
          `${lock.commit}/Dystopian%20Wars%204.0.gst`,
      );
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.byteLength) },
      });
    });
    const cache = await temp();
    const first = await fetchLockedSources(lock, cache, { fetchImpl });
    const second = await fetchLockedSources(lock, cache, { fetchImpl });
    expect(first[0].cache).toBe("miss");
    expect(second[0].cache).toBe("hit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(await readFile(first[0].file)).toEqual(body);
  });

  it("does not relabel a network failure as stale cache success", async () => {
    const body = Buffer.from("locked");
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline token=do-not-log");
    });
    await expect(
      fetchLockedSources(makeLock(body), await temp(), { fetchImpl }),
    ).rejects.toMatchObject({
      code: "NETWORK_FAILURE",
    });
  });

  it("rejects wrong content before cache publication", async () => {
    const fetchImpl = vi.fn(async () => new Response("tampered", { status: 200 }));
    await expect(
      fetchLockedSources(makeLock(Buffer.from("locked")), await temp(), { fetchImpl }),
    ).rejects.toMatchObject({
      code: "SOURCE_HASH_MISMATCH",
    });
  });

  it("rejects a declared file above 4 MiB", async () => {
    const body = Buffer.from("locked");
    const fetchImpl = vi.fn(
      async () =>
        new Response(body, {
          status: 200,
          headers: { "content-length": String(4 * 1024 * 1024 + 1) },
        }),
    );
    await expect(
      fetchLockedSources(makeLock(body), await temp(), { fetchImpl }),
    ).rejects.toMatchObject({
      code: "SOURCE_SIZE_LIMIT",
    });
  });

  it("rejects a source set above 32 MiB", async () => {
    const body = Buffer.alloc(4 * 1024 * 1024, 7);
    const base = makeLock(body);
    const lock = {
      ...base,
      files: Array.from({ length: 9 }, (_, index) => ({
        ...base.files[0],
        path: `Faction ${index}.cat`,
      })),
    };
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));
    await expect(fetchLockedSources(lock, await temp(), { fetchImpl })).rejects.toMatchObject({
      code: "SOURCE_SIZE_LIMIT",
    });
  });
});

function makeLock(body) {
  return {
    repository: "Nord0rk/Dystopian-Wars-4.0",
    commit: "a".repeat(40),
    tree: "b".repeat(40),
    files: [
      {
        path: "Dystopian Wars 4.0.gst",
        blob: "c".repeat(40),
        sha256: createHash("sha256").update(body).digest("hex"),
      },
    ],
  };
}

async function temp() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "catalog-fetch-"));
  temporary.push(directory);
  return directory;
}
