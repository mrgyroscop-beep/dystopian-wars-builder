import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { projectRosterSetup } from "../../src/application/rosters/create-roster";
import {
  canonicalJson,
  chunkDomainCatalog,
  normalizeCatalog,
  type ContentHasher,
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
await mkdir(releaseDirectory, { recursive: true });
let bundleCount = 0;
try {
  const bundles = bundleChunks(chunked.chunks);
  bundleCount = bundles.files.length;
  await Promise.all(
    bundles.files.map((file) => writeFile(path.join(releaseDirectory, file.name), file.contents)),
  );
  await writeFile(path.join(staging, "index.json"), canonicalJson(chunked.index));
  await writeFile(
    path.join(staging, "bundles.json"),
    canonicalJson({
      schemaVersion: 1,
      contentVersion: chunked.index.contentVersion,
      files: bundles.files.map(({ name, bytes, chunks }) => ({ name, bytes, chunks })),
      chunkToBundle: bundles.chunkToBundle,
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
  `Published catalog ${chunked.index.contentVersion} (${chunked.index.chunks.length} chunks in ${bundleCount} bundles, ${setup.factions.length} factions).\n`,
);

function bundleChunks(chunks: Readonly<Record<string, string>>) {
  const maximumBytes = 20 * 1024 * 1024;
  const files: Array<{ name: string; contents: string; bytes: number; chunks: number }> = [];
  const chunkToBundle: Record<string, string> = {};
  let lines: string[] = [];
  let bytes = 0;

  const flush = () => {
    if (lines.length === 0) return;
    const name = `bundle-${files.length.toString().padStart(2, "0")}.ndjson`;
    const contents = `${lines.join("\n")}\n`;
    files.push({ name, contents, bytes: Buffer.byteLength(contents), chunks: lines.length });
    for (const line of lines) {
      const separator = line.indexOf("\t");
      chunkToBundle[line.slice(0, separator)] = name;
    }
    lines = [];
    bytes = 0;
  };

  for (const [sha256, value] of Object.entries(chunks).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const line = `${sha256}\t${value}`;
    const lineBytes = Buffer.byteLength(line) + 1;
    if (lineBytes > maximumBytes) throw new Error(`Catalog chunk ${sha256} exceeds bundle budget`);
    if (bytes + lineBytes > maximumBytes) flush();
    lines.push(line);
    bytes += lineBytes;
  }
  flush();
  return { files, chunkToBundle };
}
