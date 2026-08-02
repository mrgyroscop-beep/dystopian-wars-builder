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
import {
  evaluateRoster,
  rosterInstanceId,
  type RosterSelectionInstance,
  type RosterSnapshot,
} from "../../src/domain/roster";
import { projectRosterSetup } from "../../src/application/rosters/create-roster";
import {
  applyShipEditorCommand,
  projectShipEditor,
  type ShipEditorReadyReadModel,
} from "../../src/application/rosters/ship-editor";

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

  it("evaluates real Empire/Akita costs and a second faction through stable IDs", () => {
    const empire = Object.values(first.entities).filter(
      (entity) => entity.provenance.documentPath === "Empire.cat",
    );
    const unit = empire.find(
      (entity) => entity.kind === "Unit" && entity.label.plainText === "Akita Super Battleship",
    )!;
    const model = empire.find(
      (entity) => entity.kind === "Model" && entity.label.plainText === "Akita",
    )!;
    const modelPlacement = Object.values(first.placements).find(
      (placement) => placement.ownerId === unit.id && placement.definitionId === model.id,
    )!;
    expect(modelPlacement.overlay.cardinality).toMatchObject({
      minimum: { state: "value", value: "1" },
      maximum: { state: "value", value: "1" },
    });
    expect(modelPlacement).toBeDefined();
    const forceInstance = rosterInstanceId("real:empire:akita-unit");
    const modelInstance = rosterInstanceId("real:empire:akita-model");
    const empireRoster: RosterSnapshot = {
      contractVersion: 1,
      id: "real-empire-akita",
      catalogContentVersion: first.contentVersion,
      rootInstanceIds: [forceInstance],
      instances: {
        [forceInstance]: {
          contractVersion: 1,
          id: forceInstance,
          definitionId: unit.id,
          placementId: null,
          slotId: null,
          parentInstanceId: null,
          forceInstanceId: forceInstance,
          quantity: 1,
        },
        [modelInstance]: {
          contractVersion: 1,
          id: modelInstance,
          definitionId: model.id,
          placementId: modelPlacement.id,
          slotId: modelPlacement.slotId,
          parentInstanceId: forceInstance,
          forceInstanceId: forceInstance,
          quantity: 1,
        },
      },
    };
    const empireResult = evaluateRoster(first, empireRoster);
    expect(empireResult.totals.find((total) => total.resource === "points")).toMatchObject({
      value: "350",
      complete: true,
    });
    expect(empireResult.totals.find((total) => total.resource === "victory-points")).toMatchObject({
      value: "9",
      complete: true,
    });
    expect(
      empireResult.slots.filter((result) => first.slots[result.slotId]?.kind === "Hardpoint"),
    ).toHaveLength(4);

    const crownModels = Object.values(first.entities).filter(
      (entity) => entity.kind === "Model" && entity.provenance.documentPath === "Crown.cat",
    );
    const crownModel = crownModels.find((candidate) => {
      const pointCosts = candidate.costIds
        .map((id) => first.entities[id])
        .filter(
          (entity) =>
            entity?.kind === "Cost" &&
            entity.semantics.resource === "points" &&
            entity.amount.state === "value",
        );
      return pointCosts.length === 1;
    })!;
    expect(crownModel).toBeDefined();
    const crownPointCost = crownModel.costIds
      .map((id) => first.entities[id])
      .find(
        (entity) =>
          entity?.kind === "Cost" &&
          entity.semantics.resource === "points" &&
          entity.amount.state === "value",
      )!;
    if (crownPointCost.kind !== "Cost" || crownPointCost.amount.state !== "value")
      throw new Error("Crown point cost fixture is invalid");
    const crownInstance = rosterInstanceId("real:crown:model");
    const crownResult = evaluateRoster(first, {
      contractVersion: 1,
      id: "real-crown-model",
      catalogContentVersion: first.contentVersion,
      rootInstanceIds: [crownInstance],
      instances: {
        [crownInstance]: {
          contractVersion: 1,
          id: crownInstance,
          definitionId: crownModel.id,
          placementId: null,
          slotId: null,
          parentInstanceId: null,
          forceInstanceId: crownInstance,
          quantity: 1,
        },
      },
    });
    expect(crownResult.contributions).toContainEqual(
      expect.objectContaining({
        instanceId: crownInstance,
        costId: crownPointCost.id,
        unitValue: crownPointCost.amount.value,
        value: crownPointCost.amount.value,
      }),
    );
  });

  it("pins the real Akita editor from 0/4 to 4/4 and evaluates Kagutsuchi/Magma", () => {
    const empire = Object.values(first.entities).filter(
      (entity) => entity.provenance.documentPath === "Empire.cat",
    );
    const unit = empire.find(
      (entity) => entity.kind === "Unit" && entity.label.plainText === "Akita Super Battleship",
    )!;
    const model = empire.find(
      (entity) => entity.kind === "Model" && entity.label.plainText === "Akita",
    )!;
    const modelPlacement = Object.values(first.placements).find(
      (placement) => placement.ownerId === unit.id && placement.definitionId === model.id,
    )!;
    let snapshot = realAkitaSnapshot(unit.id, model.id, modelPlacement.id);
    let projected = readyEditor(
      projectShipEditor(
        snapshot,
        first,
        rosterInstanceId("real:akita:unit"),
        unit.id,
        "saved-local",
      ),
    );
    expect(projected.mandatory).toEqual({ selected: 0, required: 4 });
    expect(
      projected.problems.filter((problem) => problem.id.startsWith("mandatory:")),
    ).toHaveLength(4);
    expect(new Set(projected.problems.map((problem) => problem.id)).size).toBe(
      projected.problems.length,
    );

    let created = 0;
    for (const group of projected.groups.filter((candidate) => candidate.minimum === 1)) {
      const preferred =
        group.options.find((option) => option.label === "Magma Cast Generator") ??
        group.options.find((option) => option.availability === "available")!;
      snapshot = applyShipEditorCommand(
        snapshot,
        first,
        {
          type: "replace-exclusive",
          instanceId: "real:akita:unit",
          groupId: group.id,
          optionId: preferred.id,
        },
        () => `real:akita:choice:${++created}`,
      );
      projected = readyEditor(
        projectShipEditor(snapshot, first, "real:akita:unit", unit.id, "saved-local"),
      );
    }
    expect(projected.mandatory).toEqual({ selected: 4, required: 4 });
    expect(projected.problems.filter((problem) => problem.id.startsWith("mandatory:"))).toEqual([]);

    const kagutsuchi = empire.find(
      (entity) =>
        entity.kind === "Battlefleet" &&
        entity.label.plainText.includes("Kagutsuchi Volcanic Battlefleet"),
    )!;
    expect(kagutsuchi).toBeDefined();
    let conditional = realAkitaSnapshot(unit.id, model.id, modelPlacement.id, kagutsuchi.id);
    let conditionalModel = readyEditor(
      projectShipEditor(conditional, first, "real:akita:unit", unit.id, "saved-local"),
    );
    expect(
      conditionalModel.problems.some((problem) => problem.title.includes("Magma Cast Generator")),
    ).toBe(true);
    const psa = conditionalModel.groups.find((group) =>
      group.options.some((option) => option.label === "Magma Cast Generator"),
    );
    if (!psa)
      throw new Error(
        JSON.stringify(
          conditionalModel.groups.map((group) => ({
            label: group.label,
            options: group.options.map((option) => option.label).slice(0, 12),
          })),
        ),
      );
    const magma = psa.options.find((option) => option.label === "Magma Cast Generator")!;
    conditional = applyShipEditorCommand(
      conditional,
      first,
      {
        type: "replace-exclusive",
        instanceId: "real:akita:unit",
        groupId: psa.id,
        optionId: magma.id,
      },
      () => "real:akita:magma",
    );
    conditionalModel = readyEditor(
      projectShipEditor(conditional, first, "real:akita:unit", unit.id, "saved-local"),
    );
    expect(conditionalModel.problems.map((problem) => problem.title).join(" ")).not.toContain(
      "requires a Magma Cast Generator",
    );
  });

  it("projects every real forceEntry into the creation scenario without publishing payloads", () => {
    const setup = projectRosterSetup(first);
    const projectedBattlefleets = setup.factions.flatMap((faction) => faction.battlefleets);
    const realBattlefleets = Object.values(first.entities).filter(
      (entity) => entity.kind === "Battlefleet",
    );
    expect(setup.mode).toBe("current");
    expect(setup.factions.map((faction) => faction.label).sort()).toEqual([
      "Alliance",
      "Commonwealth",
      "Crown",
      "Empire",
      "Enlightened",
      "Imperium",
      "Sultanate",
      "Union",
    ]);
    expect(projectedBattlefleets).toHaveLength(realBattlefleets.length);
    expect(projectedBattlefleets.length).toBeGreaterThan(20);
    for (const option of projectedBattlefleets) {
      expect(first.entities[option.id]?.kind).toBe("Battlefleet");
      expect(option.label).not.toBe("");
    }
    expect(
      projectedBattlefleets.some((battlefleet) => battlefleet.requiredElements.length > 0),
    ).toBe(true);
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

function readyEditor(model: ReturnType<typeof projectShipEditor>): ShipEditorReadyReadModel {
  if (model.dataState !== "ready") throw new Error(`${model.dataState}: ${model.detail}`);
  return model;
}

function realAkitaSnapshot(
  unitDefinitionId: string,
  modelDefinitionId: string,
  modelPlacementId: string,
  forceDefinitionId?: string,
): RosterSnapshot {
  const forceId = rosterInstanceId("real:akita:force");
  const unitId = rosterInstanceId("real:akita:unit");
  const modelId = rosterInstanceId("real:akita:model");
  const unit = realInstance(
    unitId,
    unitDefinitionId,
    forceDefinitionId ? forceId : null,
    forceDefinitionId ? forceId : unitId,
  );
  const model = realInstance(
    modelId,
    modelDefinitionId,
    unitId,
    unit.forceInstanceId ?? unitId,
    modelPlacementId,
  );
  const force = forceDefinitionId ? realInstance(forceId, forceDefinitionId, null, forceId) : null;
  return {
    contractVersion: 1,
    id: "real-akita-editor",
    catalogContentVersion: first.contentVersion,
    rootInstanceIds: [force?.id ?? unit.id],
    instances: {
      ...(force ? { [force.id]: force } : {}),
      [unit.id]: unit,
      [model.id]: model,
    },
  };
}

function realInstance(
  id: ReturnType<typeof rosterInstanceId>,
  definitionId: string,
  parentInstanceId: ReturnType<typeof rosterInstanceId> | null,
  forceInstanceId: ReturnType<typeof rosterInstanceId>,
  placementId: string | null = null,
): RosterSelectionInstance {
  return {
    contractVersion: 1,
    id,
    definitionId: definitionId as RosterSelectionInstance["definitionId"],
    placementId: placementId as RosterSelectionInstance["placementId"],
    slotId: null,
    parentInstanceId,
    forceInstanceId,
    quantity: 1,
  };
}

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
