import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDataset } from "./build-dataset.mjs";
import {
  promoteDataset,
  readCurrent,
  recordOperationalFailure,
  rollbackDataset,
} from "./promotion.mjs";

const temporary = [];
afterEach(async () =>
  Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe("deterministic dataset and atomic lifecycle", () => {
  it("builds byte-identical artifacts without wall-clock fields", async () => {
    const { lock, sources } = await fixtureSet();
    const left = await buildDataset(lock, sources);
    const right = await buildDataset(lock, [...sources].reverse().reverse());
    expect(left.releaseId).toBe(right.releaseId);
    expect([...left.files]).toEqual([...right.files]);
    expect(left.files.get("manifest.json")).not.toMatch(/created|generatedAt|timestamp/iu);
  });

  it("retains last-known-good and rolls back with CAS", async () => {
    const { lock, sources } = await fixtureSet();
    const runtime = await temp("catalog-runtime-");
    const first = await buildDataset(lock, sources);
    await promoteDataset(first, runtime, {
      expectedCurrent: null,
      attemptedAt: "2026-08-01T00:00:00.000Z",
    });

    const second = {
      ...first,
      releaseId: createHash("sha256").update("broken").digest("hex"),
    };
    await expect(
      promoteDataset(second, runtime, { expectedCurrent: first.releaseId }),
    ).rejects.toMatchObject({ code: "RELEASE_INVALID" });
    expect(await readCurrent(runtime)).toEqual({ releaseId: first.releaseId });

    const alternative = await buildDataset({ ...lock, commit: "d".repeat(40) }, sources);
    await promoteDataset(alternative, runtime, {
      expectedCurrent: first.releaseId,
      attemptedAt: "2026-08-01T00:01:00.000Z",
    });
    await rollbackDataset(runtime, first.releaseId, {
      expectedCurrent: alternative.releaseId,
      attemptedAt: "2026-08-01T00:02:00.000Z",
    });
    expect(await readCurrent(runtime)).toEqual({ releaseId: first.releaseId });
    await expect(
      promoteDataset(alternative, runtime, { expectedCurrent: null }),
    ).rejects.toMatchObject({
      code: "PROMOTION_CAS_MISMATCH",
    });
  });

  it("does not replace last-known-good after corrupt XML", async () => {
    const { lock, sources } = await fixtureSet();
    const runtime = await temp("catalog-corrupt-");
    const good = await buildDataset(lock, sources);
    await promoteDataset(good, runtime, { expectedCurrent: null });
    await writeFile(sources[1].file, "<catalogue>");
    await expect(buildDataset(lock, sources)).rejects.toMatchObject({ code: "XML_INVALID" });
    expect(await readCurrent(runtime)).toEqual({ releaseId: good.releaseId });
  });

  it("fails unresolved and ambiguous targetId references", async () => {
    const unresolved = await fixtureSet();
    await writeFile(
      unresolved.sources[1].file,
      '<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="cat-1" name="Faction 1" revision="1" gameSystemId="sys"><entryLink id="link" targetId="missing"/></catalogue>',
    );
    await expect(buildDataset(unresolved.lock, unresolved.sources)).rejects.toMatchObject({
      code: "TARGET_UNRESOLVED",
    });

    const ambiguous = await fixtureSet();
    for (const index of [1, 2]) {
      await writeFile(
        ambiguous.sources[index].file,
        `<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="cat-${index}" name="Faction ${index}" revision="1" gameSystemId="sys"><rule id="shared"/></catalogue>`,
      );
    }
    await writeFile(
      ambiguous.sources[3].file,
      '<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="cat-3" name="Faction 3" revision="1" gameSystemId="sys"><entryLink targetId="shared"/></catalogue>',
    );
    await expect(buildDataset(ambiguous.lock, ambiguous.sources)).rejects.toMatchObject({
      code: "TARGET_AMBIGUOUS",
    });
  });

  it("redacts secrets from the separate operational failure record", async () => {
    const runtime = await temp("catalog-diagnostics-");
    await recordOperationalFailure(
      runtime,
      Object.assign(new Error("offline token=super-secret"), {
        code: "NETWORK_FAILURE",
        details: { authorization: "Bearer super-secret" },
      }),
      "2026-08-01T00:00:00.000Z",
    );
    const diagnostics = await readFile(path.join(runtime, "operational.json"), "utf8");
    expect(diagnostics).not.toContain("super-secret");
    expect(diagnostics).toContain("[REDACTED]");
    expect(await readCurrent(runtime)).toBeUndefined();
  });
});

async function fixtureSet() {
  const directory = await temp("catalog-set-");
  const sources = [];
  const files = [];
  for (let index = 0; index < 10; index += 1) {
    const gameSystem = index === 0;
    const sourcePath = gameSystem ? "Dystopian Wars 4.0.gst" : `Faction ${index}.cat`;
    const xml = gameSystem
      ? '<gameSystem xmlns="http://www.battlescribe.net/schema/gameSystemSchema" id="sys" name="Game" revision="1"><rules><rule id="rule" name="Rule"/></rules></gameSystem>'
      : `<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="cat-${index}" name="Faction ${index}" revision="1" gameSystemId="sys"><entryLink id="link-${index}" targetId="rule"/></catalogue>`;
    const file = path.join(directory, sourcePath);
    await writeFile(file, xml);
    const digest = createHash("sha256").update(xml).digest("hex");
    const locked = { path: sourcePath, blob: String(index).padStart(40, "a"), sha256: digest };
    files.push(locked);
    sources.push({ ...locked, file, bytes: Buffer.byteLength(xml), cache: "hit" });
  }
  return {
    lock: {
      repository: "Nord0rk/Dystopian-Wars-4.0",
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      files,
    },
    sources,
  };
}

async function temp(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}
