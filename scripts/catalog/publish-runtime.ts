import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

import { projectRosterSetup } from "../../src/application/rosters/create-roster";
import {
  canonicalJson,
  chunkDomainCatalog,
  normalizeCatalog,
  type ContentHasher,
  type DomainCatalog,
  type LosslessGraph,
} from "../../src/domain/catalog";
import { buildDataset } from "./lib/build-dataset.mjs";
import { fetchLockedSources } from "./lib/fetch-sources.mjs";
import { readSourceLock } from "./lib/source-lock.mjs";
import { verifyLockedProvenance } from "./lib/verify-provenance.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const publicRoot = path.join(repositoryRoot, "public");
const target = path.join(publicRoot, "catalog");
const staging = path.join(publicRoot, `.catalog-${randomUUID()}`);
const publicationPath = path.join(import.meta.dirname, "publication.json");
const publication = JSON.parse(await readFile(publicationPath, "utf8")) as {
  sourceRepository: string;
  authorization: string;
  confirmedAt: string;
  publishSourcePayload: boolean;
  publishGeneratedCatalog: boolean;
};

if (
  publication.authorization !== "confirmed-by-project-owner" ||
  publication.publishSourcePayload ||
  !publication.publishGeneratedCatalog
) {
  throw new Error("Catalog publication authorization is missing or unsafe");
}

const lock = await readSourceLock(path.join(import.meta.dirname, "source-lock.json"));
if (publication.sourceRepository !== lock.repository)
  throw new Error("Catalog publication authorization does not match the source lock");

const provenance = await verifyLockedProvenance(lock);
const sources = await fetchLockedSources(lock, path.join(repositoryRoot, ".cache/catalog"));
const imported = await buildDataset(lock, sources, provenance);
const graphJson = imported.files.get("catalog.json");
if (!graphJson) throw new Error("Imported catalog graph is missing");

const normalized = normalizeCatalog({
  graph: JSON.parse(graphJson) as LosslessGraph,
  source: imported.manifest.source.resolved,
});
const hasher: ContentHasher = {
  sha256(value) {
    return Promise.resolve(createHash("sha256").update(value).digest("hex"));
  },
};
const chunked = await chunkDomainCatalog(normalized, hasher);
const currentCatalog = { ...normalized, contentVersion: chunked.index.contentVersion };
const setup = projectRosterSetup(currentCatalog);

await rm(staging, { recursive: true, force: true });
const releaseDirectory = path.join(staging, "releases", chunked.index.contentVersion);
const factionDirectory = path.join(releaseDirectory, "factions");
await mkdir(factionDirectory, { recursive: true });
try {
  const factions = Object.fromEntries(
    await Promise.all(
      setup.factions.map(async (faction) => {
        const scoped = projectFactionCatalog(currentCatalog, faction.id);
        const contents = canonicalJson(scoped);
        const decodedBytes = Buffer.byteLength(contents);
        const compressed = gzipSync(contents, { level: 9 });
        const bytes = compressed.byteLength;
        if (bytes > 25 * 1024 * 1024)
          throw new Error(`Faction catalog ${faction.label} exceeds Cloudflare's asset limit`);
        const sha256 = createHash("sha256").update(contents).digest("hex");
        const name = `${safeFileName(faction.label)}-${sha256.slice(0, 12)}.json.gz`;
        await writeFile(path.join(factionDirectory, name), compressed);
        return [
          faction.id,
          {
            label: faction.label,
            path: `releases/${chunked.index.contentVersion}/factions/${name}`,
            sha256,
            bytes,
            decodedBytes,
            entities: Object.keys(scoped.entities).length,
          },
        ] as const;
      }),
    ),
  );
  await writeFile(
    path.join(staging, "factions.json"),
    canonicalJson({
      schemaVersion: 1,
      contentVersion: chunked.index.contentVersion,
      factions,
    }),
  );
  await writeFile(path.join(staging, "setup.json"), canonicalJson(setup));
  await writeFile(
    path.join(staging, "source.json"),
    canonicalJson({
      schemaVersion: 1,
      repository: lock.repository,
      commit: lock.commit,
      tree: lock.tree,
      commitTimestamp: lock.commitTimestamp,
      contentVersion: chunked.index.contentVersion,
      authorization: publication.authorization,
      authorizationConfirmedAt: publication.confirmedAt,
      sourceUrl: `https://github.com/${lock.repository}`,
      generatedCatalogPublished: true,
    }),
  );
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
} catch (error) {
  await rm(staging, { recursive: true, force: true });
  throw error;
}

process.stdout.write(
  `Published catalog ${chunked.index.contentVersion} (${setup.factions.length} faction assets).\n`,
);

function projectFactionCatalog(catalog: DomainCatalog, factionId: string): DomainCatalog {
  const faction = catalog.entities[factionId];
  if (faction?.kind !== "Faction") throw new Error(`Unknown faction ${factionId}`);
  const entityIds = new Set<string>(
    Object.values(catalog.entities)
      .filter((entity) => entity.provenance.documentPath === faction.provenance.documentPath)
      .map((entity) => entity.id),
  );
  const followsOwnedContent = (id: string) => {
    const documentPath = catalog.entities[id]?.provenance.documentPath;
    return (
      documentPath === faction.provenance.documentPath ||
      documentPath === "Dystopian Wars 4.0.gst" ||
      documentPath === "Rules Glossary.cat"
    );
  };
  const aliasIds = new Set<string>();
  let changed = true;
  while (changed) {
    const before = entityIds.size + aliasIds.size;
    for (const id of [...entityIds]) {
      const entity = catalog.entities[id];
      if (!entity) continue;
      collectEntityReferences(entity, catalog, entityIds);
      for (const alias of entity.identity.migrationAliasIds) aliasIds.add(alias);
    }
    for (const placement of Object.values(catalog.placements)) {
      if (!entityIds.has(placement.ownerId) || !followsOwnedContent(placement.ownerId)) continue;
      collectEntityReferences(placement, catalog, entityIds);
    }
    for (const slot of Object.values(catalog.slots)) {
      if (!entityIds.has(slot.ownerId) || !followsOwnedContent(slot.ownerId)) continue;
      collectEntityReferences(slot, catalog, entityIds);
    }
    for (const [aliasId, alias] of Object.entries(catalog.aliases)) {
      if (!aliasIds.has(aliasId) && !alias.entityIds.some((id) => entityIds.has(id))) continue;
      aliasIds.add(aliasId);
      for (const id of alias.entityIds) entityIds.add(id);
    }
    changed = entityIds.size + aliasIds.size !== before;
  }

  const sourceNodeIds = new Set(
    [...entityIds].map((id) => catalog.entities[id]?.identity.sourceNodeId).filter(Boolean),
  );
  return {
    ...catalog,
    entities: selectRecord(catalog.entities, (id) => entityIds.has(id)),
    placements: selectRecord(
      catalog.placements,
      (_id, placement) =>
        entityIds.has(placement.ownerId) &&
        followsOwnedContent(placement.ownerId) &&
        (!placement.definitionId || entityIds.has(placement.definitionId)),
    ),
    slots: selectRecord(
      catalog.slots,
      (_id, slot) => entityIds.has(slot.ownerId) && followsOwnedContent(slot.ownerId),
    ),
    aliases: selectRecord(catalog.aliases, (id) => aliasIds.has(id)),
    roots: catalog.roots.filter((id) => entityIds.has(id)),
    diagnostics: catalog.diagnostics.filter((diagnostic) =>
      sourceNodeIds.has(diagnostic.sourceNodeId),
    ),
  };
}

function collectEntityReferences(value: unknown, catalog: DomainCatalog, ids: Set<string>): void {
  if (typeof value === "string") {
    if (catalog.entities[value]) ids.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectEntityReferences(item, catalog, ids);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const item of Object.values(value)) collectEntityReferences(item, catalog, ids);
}

function selectRecord<Value>(
  source: Readonly<Record<string, Value>>,
  include: (id: string, value: Value) => boolean,
): Record<string, Value> {
  return Object.fromEntries(Object.entries(source).filter(([id, value]) => include(id, value)));
}

function safeFileName(value: string): string {
  return value
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}
