import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildDataset } from "../catalog/lib/build-dataset.mjs";
import { fetchLockedSources } from "../catalog/lib/fetch-sources.mjs";
import { readSourceLock } from "../catalog/lib/source-lock.mjs";
import { verifyLockedProvenance } from "../catalog/lib/verify-provenance.mjs";
import {
  canonicalJson,
  chunkDomainCatalog,
  MAX_CHUNK_BYTES,
  loadDomainCatalog,
  normalizeCatalog,
  persistChunkedCatalog,
  reconstructDomainCatalog,
  type ContentHasher,
  type DomainCatalog,
  type LosslessGraph,
} from "../../src/domain/catalog";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
let temporary = "";
let first: DomainCatalog;
let firstBytes = "";
let chunks: Awaited<ReturnType<typeof chunkDomainCatalog>>;
let elapsedMs = 0;
let peakHeapBytes = 0;
const hasher: ContentHasher = {
  sha256(value) {
    return Promise.resolve(createHash("sha256").update(value).digest("hex"));
  },
};

beforeAll(async () => {
  temporary = await mkdtemp(path.join(os.tmpdir(), "dwb-domain-real-"));
  const lock = await readSourceLock(path.join(repositoryRoot, "scripts/catalog/source-lock.json"));
  const provenance = await verifyLockedProvenance(lock);
  const sources = await fetchLockedSources(
    lock,
    process.env.DWB_CATALOG_CACHE ?? path.join(temporary, "cache"),
  );
  const imported = await buildDataset(lock, sources, provenance);
  process.stdout.write("domain-real: import complete\n");
  const graphBytes = imported.files.get("catalog.json");
  if (!graphBytes) throw new Error("KAN-30 graph output is missing");
  const graph = JSON.parse(graphBytes) as LosslessGraph;
  const input = { graph, source: imported.manifest.source.resolved };
  peakHeapBytes = process.memoryUsage().heapUsed;
  const started = performance.now();
  first = normalizeCatalog(input, {
    observeMemoryCheckpoint() {
      peakHeapBytes = Math.max(peakHeapBytes, process.memoryUsage().heapUsed);
    },
  });
  elapsedMs = performance.now() - started;
  firstBytes = canonicalJson(first);
  process.stdout.write(`domain-real: normalize complete ${Math.round(elapsedMs)}ms\n`);
  chunks = await chunkDomainCatalog(first, hasher);
  process.stdout.write(`domain-real: chunks complete ${chunks.index.chunks.length}\n`);
  const secondBytes = canonicalJson(normalizeCatalog(structuredClone(input)));
  process.stdout.write("domain-real: second normalize complete\n");
  if (firstBytes !== secondBytes)
    throw new Error("Real normalized model is not byte deterministic");
});

afterAll(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

describe("pinned real domain model", () => {
  it("covers every playable faction structurally", () => {
    const playable = [
      "Alliance",
      "Commonwealth",
      "Crown",
      "Empire",
      "Enlightened",
      "Imperium",
      "Sultanate",
      "Union",
    ];
    const entities = Object.values(first.entities);
    for (const faction of playable) {
      const pathPrefix = `${faction}.cat`;
      expect(
        entities.some((entity) => entity.kind === "Faction" && entity.label.plainText === faction),
      ).toBe(true);
      for (const kind of [
        "Battlefleet",
        "BattlefleetElement",
        "Unit",
        "Model",
        "Profile",
      ] as const) {
        expect(
          entities.some(
            (entity) => entity.kind === kind && entity.provenance.documentPath === pathPrefix,
          ),
          `${faction} ${kind}`,
        ).toBe(true);
      }
    }
  });

  it("derives the Empire/Akita walkthrough without effective evaluation", () => {
    const entities = Object.values(first.entities).filter(
      (entity) => entity.provenance.documentPath === "Empire.cat",
    );
    const unit = entities.find(
      (entity) => entity.kind === "Unit" && entity.label.plainText === "Akita Super Battleship",
    )!;
    const model = entities.find(
      (entity) => entity.kind === "Model" && entity.label.plainText === "Akita",
    )!;
    expect(unit).toBeDefined();
    expect(model).toBeDefined();
    const modelCosts = model.costIds.map((id) => first.entities[id]!).filter(Boolean);
    expect(
      modelCosts.some(
        (cost) =>
          cost.kind === "Cost" &&
          cost.label.plainText === "Points" &&
          cost.amount.state === "value" &&
          cost.amount.value === "350",
      ),
    ).toBe(true);
    expect(
      modelCosts.some(
        (cost) =>
          cost.kind === "Cost" &&
          cost.label.plainText === "VP per Model" &&
          cost.amount.state === "value" &&
          cost.amount.value === "9",
      ),
    ).toBe(true);
    const unitPlacements = descendants(unit.id);
    const hardpoints = unitPlacements
      .map((id) => first.entities[id])
      .filter((entity) => entity?.kind === "Hardpoint");
    expect(hardpoints.map((entity) => entity.label.plainText).sort()).toEqual([
      "Heavy Hardpoint: FPS",
      "Heavy Hardpoint: FPS",
      "Heavy Hardpoint: FPS",
      "Heavy Hardpoint: PSA",
    ]);
    const referencedKinds = Object.values(first.placements)
      .filter(
        (placement) =>
          [unit.id, ...unitPlacements].includes(placement.ownerId) &&
          placement.linkKind === "reference" &&
          placement.definitionId,
      )
      .map((placement) => first.entities[placement.definitionId!]!.kind);
    expect(referencedKinds).toEqual(expect.arrayContaining(["Generator", "Attachment", "Escort"]));
    expect(
      entities.some((entity) => entity.kind === "Profile" && entity.label.plainText === "Akita"),
    ).toBe(true);
    expect(entities.some((entity) => "expression" in entity && "effectiveValue" in entity)).toBe(
      false,
    );
  });

  it("has unique identities, reference closure and deterministic reconstruction", async () => {
    expect(new Set(Object.keys(first.entities)).size).toBe(Object.keys(first.entities).length);
    for (const placement of Object.values(first.placements)) {
      expect(first.entities[placement.ownerId]).toBeDefined();
      if (placement.definitionId) expect(first.entities[placement.definitionId]).toBeDefined();
    }
    expect(chunks.index.chunks.every((chunk) => chunk.bytes <= MAX_CHUNK_BYTES)).toBe(true);
    const reconstructed = await reconstructDomainCatalog(chunks, hasher);
    expect({ ...reconstructed, contentVersion: "unversioned" }).toEqual(first);
    const indexes = new Map<string, typeof chunks.index>();
    const storedChunks = new Map<string, string>();
    const repository = {
      contractVersion: 1 as const,
      writeChunk(sha256: string, value: string) {
        storedChunks.set(sha256, value);
        return Promise.resolve();
      },
      writeIndex(index: typeof chunks.index) {
        indexes.set(index.contentVersion, index);
        return Promise.resolve();
      },
      loadIndex(contentVersion: string) {
        const index = indexes.get(contentVersion);
        if (!index) return Promise.reject(new Error("missing persisted index"));
        return Promise.resolve(index);
      },
      loadChunk(sha256: string) {
        const value = storedChunks.get(sha256);
        if (!value) return Promise.reject(new Error("missing persisted chunk"));
        return Promise.resolve(value);
      },
    };
    await persistChunkedCatalog(chunks, repository);
    const loaded = await loadDomainCatalog(chunks.index.contentVersion, repository, hasher);
    expect(loaded).toEqual(reconstructed);
    for (const id of Object.keys(loaded.entities))
      expect(chunks.index.entityChunkById[id]).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("meets normalization, heap, index and lookup budgets", async () => {
    expect(elapsedMs).toBeLessThanOrEqual(15_000);
    expect(peakHeapBytes).toBeLessThanOrEqual(512 * 1024 * 1024);
    const indexes = new Map<string, typeof chunks.index>();
    const storedChunks = new Map<string, string>();
    const persistedRepository = {
      contractVersion: 1 as const,
      writeChunk(sha256: string, value: string) {
        storedChunks.set(sha256, value);
        return Promise.resolve();
      },
      writeIndex(index: typeof chunks.index) {
        indexes.set(index.contentVersion, index);
        return Promise.resolve();
      },
      loadIndex(contentVersion: string) {
        const index = indexes.get(contentVersion);
        return index
          ? Promise.resolve(index)
          : Promise.reject(new Error("missing persisted index"));
      },
      loadChunk(sha256: string) {
        const value = storedChunks.get(sha256);
        return value
          ? Promise.resolve(value)
          : Promise.reject(new Error("missing persisted chunk"));
      },
    };
    await persistChunkedCatalog(chunks, persistedRepository);
    const persistedIndex = await persistedRepository.loadIndex(chunks.index.contentVersion);
    const factionIndexHashes = Object.values(persistedIndex.views.factionIndexChunks);
    expect(factionIndexHashes).toHaveLength(8);
    for (const sha256 of factionIndexHashes) {
      const factionIndex = await persistedRepository.loadChunk(sha256);
      expect(gzipSync(factionIndex).byteLength).toBeLessThanOrEqual(250 * 1024);
    }
    const target = Object.keys(first.entities)[Math.floor(Object.keys(first.entities).length / 2)]!;
    const started = performance.now();
    for (let index = 0; index < 100; index += 1) {
      const persisted = await persistedRepository.loadIndex(chunks.index.contentVersion);
      const sha256 = persisted.entityChunkById[target];
      expect(sha256).toBeDefined();
      expect(await persistedRepository.loadChunk(sha256!)).toContain(target);
    }
    const persistedLookupMs = (performance.now() - started) / 100;
    expect(persistedLookupMs).toBeLessThanOrEqual(50);

    const evidence = {
      schemaVersion: first.schemaVersion,
      sourceCommit: first.source.commit,
      sourceTree: first.source.tree,
      contentVersion: chunks.index.contentVersion,
      deterministic: true,
      documents: new Set(
        Object.values(first.entities).map((entity) => entity.provenance.documentPath),
      ).size,
      entities: Object.keys(first.entities).length,
      placements: Object.keys(first.placements).length,
      slots: Object.keys(first.slots).length,
      chunks: chunks.index.chunks.map(({ id, sha256, bytes }) => ({ id, sha256, bytes })),
      elapsedMs: Math.round(elapsedMs),
      peakHeapBytes,
      peakHeapMeasurement: "normalizer-checkpoints",
      sourcePayloadPublished: false,
      persistedRoundTrip: true,
      persistedFactionIndexes: factionIndexHashes.length,
      persistedFactionIndexGzipBudgetBytes: 250 * 1024,
      persistedRepositoryLookupMs: persistedLookupMs,
      indexedLookupBudgetMs: 50,
    };
    const evidenceDirectory = path.join(repositoryRoot, "artifacts");
    await mkdir(evidenceDirectory, { recursive: true });
    await writeFile(
      path.join(evidenceDirectory, "domain-model-evidence.json"),
      canonicalJson(evidence),
    );
  });
});

function descendants(rootId: string): string[] {
  const visited = new Set<string>();
  const pending = [rootId];
  while (pending.length > 0) {
    const owner = pending.shift()!;
    for (const placement of Object.values(first.placements)) {
      if (
        placement.ownerId !== owner ||
        placement.linkKind !== "ownership" ||
        !placement.definitionId ||
        visited.has(placement.definitionId)
      )
        continue;
      visited.add(placement.definitionId);
      pending.push(placement.definitionId);
    }
  }
  return [...visited];
}
