import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildDataset, validateLinkKind } from "./build-dataset.mjs";
import {
  beginCatalogCheck,
  createOperationalDiagnostic,
  promoteDataset,
  readCurrent,
  readLifecycle,
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
    const left = await buildDataset(lock, sources, provenance(lock));
    const right = await buildDataset(lock, [...sources].reverse().reverse(), provenance(lock));
    expect(left.releaseId).toBe(right.releaseId);
    expect([...left.files]).toEqual([...right.files]);
    expect(left.files.get("manifest.json")).not.toMatch(/createdAt|generatedAt|attemptedAt/iu);
    expect(left.manifest).toMatchObject({
      schemaVersion: 2,
      source: { resolved: { commitTimestamp: lock.commitTimestamp } },
      importer: { contractVersion: 2 },
      sanitizer: { rawHtml: false, plainTextFallback: true },
      license: { status: "redistribution-unconfirmed", sourcePayloadPublished: false },
      diagnostics: { contractVersion: 1 },
    });
  });

  it("retains last-known-good and rolls back with CAS", async () => {
    const { lock, sources } = await fixtureSet();
    const runtime = await temp("catalog-runtime-");
    const first = await buildDataset(lock, sources, provenance(lock));
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

    const alternativeLock = { ...lock, commit: "d".repeat(40) };
    const alternative = await buildDataset(alternativeLock, sources, provenance(alternativeLock));
    await promoteDataset(alternative, runtime, {
      expectedCurrent: first.releaseId,
      attemptedAt: "2026-08-01T00:01:00.000Z",
    });
    expect(await readLifecycle(runtime)).toMatchObject({
      stable: {
        activeReleaseId: alternative.releaseId,
        lastKnownGoodReleaseId: first.releaseId,
      },
      latest: {
        phase: "SUCCESS",
        outcome: "SUCCESS",
        requestedReleaseId: alternative.releaseId,
        resolvedReleaseId: alternative.releaseId,
      },
    });
    await rollbackDataset(runtime, first.releaseId, {
      expectedCurrent: alternative.releaseId,
      attemptedAt: "2026-08-01T00:02:00.000Z",
    });
    expect(await readCurrent(runtime)).toEqual({ releaseId: first.releaseId });
    expect(await readLifecycle(runtime)).toMatchObject({
      stable: {
        activeReleaseId: first.releaseId,
        lastKnownGoodReleaseId: alternative.releaseId,
      },
    });
    await expect(
      promoteDataset(alternative, runtime, { expectedCurrent: null }),
    ).rejects.toMatchObject({
      code: "PROMOTION_CAS_MISMATCH",
    });
  });

  it("does not replace last-known-good after corrupt XML", async () => {
    const { lock, sources } = await fixtureSet();
    const runtime = await temp("catalog-corrupt-");
    const good = await buildDataset(lock, sources, provenance(lock));
    await promoteDataset(good, runtime, { expectedCurrent: null });
    await writeFile(sources[1].file, "<catalogue>");
    await expect(buildDataset(lock, sources, provenance(lock))).rejects.toMatchObject({
      code: "XML_INVALID",
    });
    expect(await readCurrent(runtime)).toEqual({ releaseId: good.releaseId });
  });

  it("fails unresolved and ambiguous targetId references", async () => {
    const unresolved = await fixtureSet();
    await writeFile(
      unresolved.sources[1].file,
      '<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="cat-1" name="Faction 1" revision="1" gameSystemId="sys"><entryLink id="link" targetId="missing"/></catalogue>',
    );
    await expect(
      buildDataset(unresolved.lock, unresolved.sources, provenance(unresolved.lock)),
    ).rejects.toMatchObject({
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
    await expect(
      buildDataset(ambiguous.lock, ambiguous.sources, provenance(ambiguous.lock)),
    ).rejects.toMatchObject({
      code: "TARGET_AMBIGUOUS",
    });
  });

  it("redacts secrets from the separate operational failure record", async () => {
    const runtime = await temp("catalog-diagnostics-");
    const recorded = await recordOperationalFailure(
      runtime,
      Object.assign(new Error("offline token=super-secret"), {
        code: "NETWORK_FAILURE",
        details: { authorization: "Bearer super-secret" },
      }),
      "2026-08-01T00:00:00.000Z",
    );
    const diagnosticDirectory = path.join(runtime, "diagnostics");
    const [diagnosticName] = await readdir(diagnosticDirectory);
    const diagnostics = await readFile(path.join(diagnosticDirectory, diagnosticName), "utf8");
    expect(diagnostics).not.toContain("super-secret");
    expect(JSON.parse(diagnostics)).toEqual({
      action: "RETRY",
      active: { available: false, releaseId: null },
      capability: "UNAVAILABLE",
      code: "CATALOG_NETWORK_UNAVAILABLE",
      diagnosticId: recorded.diagnosticId,
      reason: "NETWORK_UNAVAILABLE",
      retryable: true,
      schemaVersion: 1,
      severity: "warning",
      title: "Catalog unavailable",
    });
    const operation = JSON.parse(
      await readFile(path.join(runtime, "operations", `${recorded.operationId}.json`), "utf8"),
    );
    expect(operation).toMatchObject({
      stable: { activeReleaseId: null, lastKnownGoodReleaseId: null },
      latest: {
        phase: "FAILURE",
        outcome: "UNAVAILABLE",
        diagnosticId: recorded.diagnosticId,
      },
    });
    expect(JSON.stringify(operation)).not.toContain("super-secret");
    expect(await readCurrent(runtime)).toBeUndefined();
  });

  it.each([
    ["catalogueLink", "catalogue", "catalogue"],
    ["categoryLink", undefined, "categoryEntry"],
    ["entryLink", "selectionEntry", "selectionEntry"],
    ["entryLink", "selectionEntryGroup", "selectionEntryGroup"],
    ["infoLink", "profile", "profile"],
    ["infoLink", "rule", "rule"],
  ])("enforces %s/%s links to exact %s targets", (tag, type, expected) => {
    const source = { key: "source", tag, attributes: { ...(type ? { type } : {}) } };
    expect(() =>
      validateLinkKind("fixture.cat", source, { key: "target", tag: expected }),
    ).not.toThrow();
    expect(() =>
      validateLinkKind("fixture.cat", source, { key: "wrong", tag: "costType" }),
    ).toThrowError(expect.objectContaining({ code: "LINK_TARGET_KIND" }));
  });

  it("rejects an unknown link type even when the target kind exists", () => {
    expect(() =>
      validateLinkKind(
        "fixture.cat",
        { key: "source", tag: "entryLink", attributes: { type: "rule" } },
        { key: "target", tag: "rule" },
      ),
    ).toThrowError(expect.objectContaining({ code: "LINK_TYPE_INVALID" }));
    expect(() =>
      validateLinkKind(
        "fixture.cat",
        { key: "source", tag: "categoryLink", attributes: { type: "" } },
        { key: "target", tag: "categoryEntry" },
      ),
    ).toThrowError(expect.objectContaining({ code: "LINK_TYPE_INVALID" }));
  });

  it("rejects rollback path traversal before filesystem resolution", async () => {
    await expect(
      rollbackDataset(await temp("catalog-path-"), "../../outside", {}),
    ).rejects.toMatchObject({
      code: "RELEASE_ID_INVALID",
    });
  });

  it("never changes active/LKG when a promotion fails before the lifecycle commit point", async () => {
    const { lock, sources } = await fixtureSet();
    const runtime = await temp("catalog-fault-");
    const good = await buildDataset(lock, sources, provenance(lock));
    await promoteDataset(good, runtime, { expectedCurrent: null });
    const changedLock = { ...lock, commit: "e".repeat(40) };
    const candidate = await buildDataset(changedLock, sources, provenance(changedLock));

    for (const point of [
      "after-resolved",
      "after-release",
      "after-operation",
      "before-lifecycle",
    ]) {
      await expect(
        promoteDataset(candidate, runtime, {
          expectedCurrent: good.releaseId,
          fault: (currentPoint) => {
            if (currentPoint === point) throw new Error(`fault:${point}`);
          },
        }),
      ).rejects.toThrow(`fault:${point}`);
      expect(await readCurrent(runtime)).toEqual({ releaseId: good.releaseId });
      expect(await readLifecycle(runtime)).toMatchObject({
        stable: { activeReleaseId: good.releaseId, lastKnownGoodReleaseId: null },
        latest: { phase: "FAILURE", outcome: "UPDATE_FAILED_USING_LKG" },
      });
    }
  });

  it("cannot report failure after lifecycle commit even if lock cleanup fails", async () => {
    const { lock, sources } = await fixtureSet();
    const runtime = await temp("catalog-post-commit-");
    const dataset = await buildDataset(lock, sources, provenance(lock));
    await expect(
      promoteDataset(dataset, runtime, {
        expectedCurrent: null,
        cleanupLock: async () => {
          throw new Error("cleanup failed after commit");
        },
      }),
    ).resolves.toMatchObject({
      stable: { activeReleaseId: dataset.releaseId },
      latest: { phase: "SUCCESS", outcome: "SUCCESS" },
    });
    expect(await readCurrent(runtime)).toEqual({ releaseId: dataset.releaseId });
  });

  it("projects the complete checking/resolved/promoting/success/stale/failure matrix", async () => {
    const { lock, sources } = await fixtureSet();
    const runtime = await temp("catalog-matrix-");
    const dataset = await buildDataset(lock, sources, provenance(lock));
    const check = await beginCatalogCheck(runtime, { expectedCurrent: null });
    expect((await readLifecycle(runtime)).latest).toMatchObject({
      operationId: check.operationId,
      phase: "CHECKING",
      outcome: "PENDING",
    });
    const observed = [];
    const success = await promoteDataset(dataset, runtime, {
      operationId: check.operationId,
      expectedCurrent: null,
      fault: async (point) => {
        if (point === "after-resolved" || point === "after-release")
          observed.push((await readLifecycle(runtime)).latest.phase);
      },
    });
    expect(observed).toEqual(["RESOLVED", "PROMOTING"]);
    expect(success).toMatchObject({
      stable: { activeReleaseId: dataset.releaseId, lastKnownGoodReleaseId: null },
      latest: { phase: "SUCCESS", outcome: "SUCCESS", capability: "ACTIVE" },
    });

    const currentCheck = await beginCatalogCheck(runtime, {
      expectedCurrent: dataset.releaseId,
    });
    const current = await promoteDataset(dataset, runtime, {
      operationId: currentCheck.operationId,
      expectedCurrent: dataset.releaseId,
    });
    expect(current).toMatchObject({
      stable: { activeReleaseId: dataset.releaseId },
      latest: { phase: "RESOLVED", outcome: "SUCCESS" },
    });

    const changedLock = { ...lock, commit: "f".repeat(40) };
    const candidate = await buildDataset(changedLock, sources, provenance(changedLock));
    const failedCheck = await beginCatalogCheck(runtime, {
      expectedCurrent: dataset.releaseId,
    });
    await expect(
      promoteDataset(candidate, runtime, {
        operationId: failedCheck.operationId,
        expectedCurrent: dataset.releaseId,
        fault: (point) => {
          if (point === "before-lifecycle") throw new Error("injected");
        },
      }),
    ).rejects.toThrow("injected");
    expect(await readLifecycle(runtime)).toMatchObject({
      stable: { activeReleaseId: dataset.releaseId, lastKnownGoodReleaseId: null },
      latest: {
        phase: "FAILURE",
        outcome: "UPDATE_FAILED_USING_LKG",
        capability: "LAST_KNOWN_GOOD",
      },
    });

    const unavailableRuntime = await temp("catalog-unavailable-");
    const unavailableCheck = await beginCatalogCheck(unavailableRuntime, {
      expectedCurrent: null,
    });
    await recordOperationalFailure(
      unavailableRuntime,
      Object.assign(new Error("offline"), { code: "NETWORK_FAILURE" }),
      { operationId: unavailableCheck.operationId },
    );
    expect(await readLifecycle(unavailableRuntime)).toMatchObject({
      stable: { activeReleaseId: null, lastKnownGoodReleaseId: null },
      latest: { phase: "FAILURE", outcome: "UNAVAILABLE", capability: "UNAVAILABLE" },
    });
  });

  it("orders current, older, and newer candidates without inverting update availability", async () => {
    const { lock, sources } = await fixtureSet();
    const runtime = await temp("catalog-ordering-");
    const current = await buildDataset(lock, sources, provenance(lock));
    await promoteDataset(current, runtime, { expectedCurrent: null });

    const equal = await promoteDataset(current, runtime, {
      expectedCurrent: current.releaseId,
    });
    expect(equal.latest).toMatchObject({ phase: "RESOLVED", outcome: "SUCCESS" });

    const olderLock = {
      ...lock,
      commit: "c".repeat(40),
      commitTimestamp: "2025-01-01T00:00:00Z",
    };
    const older = await buildDataset(olderLock, sources, provenance(olderLock));
    const stale = await promoteDataset(older, runtime, {
      expectedCurrent: current.releaseId,
    });
    expect(stale).toMatchObject({
      stable: { activeReleaseId: current.releaseId },
      latest: {
        phase: "RESOLVED",
        outcome: "STALE",
        resolvedReleaseId: older.releaseId,
      },
    });

    const newerLock = {
      ...lock,
      commit: "d".repeat(40),
      commitTimestamp: "2026-08-02T00:00:00Z",
    };
    const newer = await buildDataset(newerLock, sources, provenance(newerLock));
    const promoted = await promoteDataset(newer, runtime, {
      expectedCurrent: current.releaseId,
    });
    expect(promoted).toMatchObject({
      stable: {
        activeReleaseId: newer.releaseId,
        lastKnownGoodReleaseId: current.releaseId,
      },
      latest: { phase: "SUCCESS", outcome: "SUCCESS" },
    });
  });

  it("creates an append-only audit record whenever operationId is null", async () => {
    const runtime = await temp("catalog-append-only-");
    const first = await recordOperationalFailure(runtime, new Error("first"), {
      operationId: null,
      attemptedAt: "2026-08-01T00:00:00.000Z",
    });
    const firstFile = path.join(runtime, "operations", `${first.operationId}.json`);
    const firstSnapshot = await readFile(firstFile, "utf8");

    const second = await recordOperationalFailure(runtime, new Error("second"), {
      operationId: null,
      attemptedAt: "2026-08-01T00:01:00.000Z",
    });
    expect(second.operationId).not.toBe(first.operationId);
    expect(await readFile(firstFile, "utf8")).toBe(firstSnapshot);
    expect((await readdir(path.join(runtime, "operations"))).sort()).toEqual(
      [`${first.operationId}.json`, `${second.operationId}.json`].sort(),
    );
  });

  it("does not let a superseded concurrent check overwrite the latest projection", async () => {
    const { lock, sources } = await fixtureSet();
    const runtime = await temp("catalog-concurrency-");
    const dataset = await buildDataset(lock, sources, provenance(lock));
    const first = await beginCatalogCheck(runtime, { expectedCurrent: null });
    const latest = await beginCatalogCheck(runtime, { expectedCurrent: null });
    await expect(
      promoteDataset(dataset, runtime, {
        operationId: first.operationId,
        expectedCurrent: null,
      }),
    ).rejects.toMatchObject({ code: "OPERATION_SUPERSEDED" });
    expect(await readLifecycle(runtime)).toMatchObject({
      stable: { activeReleaseId: null, lastKnownGoodReleaseId: null },
      latest: { operationId: latest.operationId, phase: "CHECKING", outcome: "PENDING" },
    });
  });

  it("projects only allowlisted diagnostics for adversarial error corpora", () => {
    const error = Object.assign(
      new Error('C:\\secret\\catalog.cat targetId="internal-123" <entryLink/> token=raw-secret'),
      {
        code: "XML_INVALID",
        stack: "STACK C:\\secret\\catalog.cat",
        details: {
          path: "/home/user/private.cat",
          sourceKey: "catalog.cat:internal-123",
          targetId: "internal-123",
          xml: "<entryLink/>",
        },
      },
    );
    const activeReleaseId = "a".repeat(64);
    const diagnostic = createOperationalDiagnostic(error, activeReleaseId);
    expect(Object.keys(diagnostic).sort()).toEqual(
      [
        "action",
        "active",
        "capability",
        "code",
        "diagnosticId",
        "reason",
        "retryable",
        "schemaVersion",
        "severity",
        "title",
      ].sort(),
    );
    expect(diagnostic).toMatchObject({
      code: "CATALOG_SOURCE_INVALID",
      reason: "SOURCE_INVALID",
      active: { available: true, releaseId: activeReleaseId },
    });
    const serialized = JSON.stringify(diagnostic);
    for (const forbidden of [
      "secret",
      "catalog.cat",
      "internal-123",
      "entryLink",
      "raw-secret",
      "/home/",
      "STACK",
    ])
      expect(serialized).not.toContain(forbidden);
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
      : `<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="cat-${index}" name="Faction ${index}" revision="1" gameSystemId="sys"><infoLink id="link-${index}" type="rule" targetId="rule"/></catalogue>`;
    const file = path.join(directory, sourcePath);
    await writeFile(file, xml);
    const digest = createHash("sha256").update(xml).digest("hex");
    const locked = {
      path: sourcePath,
      blob: String(index).padStart(40, "a"),
      bytes: Buffer.byteLength(xml),
      sha256: digest,
    };
    files.push(locked);
    sources.push({ ...locked, file, bytes: Buffer.byteLength(xml), cache: "hit" });
  }
  return {
    lock: {
      repository: "Nord0rk/Dystopian-Wars-4.0",
      commit: "a".repeat(40),
      tree: "b".repeat(40),
      commitTimestamp: "2026-08-01T00:00:00Z",
      files,
    },
    sources,
  };
}

function provenance(lock) {
  return {
    repository: lock.repository,
    commit: lock.commit,
    tree: lock.tree,
    commitTimestamp: lock.commitTimestamp,
    files: lock.files.map(({ path: sourcePath, blob, bytes }) => ({
      path: sourcePath,
      blob,
      bytes,
    })),
  };
}

async function temp(prefix) {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}
