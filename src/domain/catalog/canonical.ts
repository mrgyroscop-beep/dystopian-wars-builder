import type {
  CatalogChunk,
  CatalogIndex,
  ChunkedDomainCatalog,
  ContentHasher,
  DomainCatalog,
} from "./types";

export const MAX_CHUNK_BYTES = 512 * 1024;

export class ChunkBudgetError extends Error {
  constructor(
    readonly kind: CatalogChunk["kind"],
    readonly bytes: number,
  ) {
    super(`${kind} entry exceeds ${MAX_CHUNK_BYTES} bytes`);
    this.name = "ChunkBudgetError";
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export async function chunkDomainCatalog(
  catalog: DomainCatalog,
  hasher: ContentHasher,
): Promise<ChunkedDomainCatalog> {
  const chunks: CatalogChunk[] = [];
  const entityChunkById: Record<string, string> = {};
  const placementChunkById: Record<string, string> = {};
  const slotChunkById: Record<string, string> = {};
  const diagnostics = Object.fromEntries(
    catalog.diagnostics.map((diagnostic, index) => [index.toString().padStart(8, "0"), diagnostic]),
  );

  const groups = [
    ["entities", catalog.entities, entityChunkById],
    ["placements", catalog.placements, placementChunkById],
    ["slots", catalog.slots, slotChunkById],
    ["aliases", catalog.aliases, undefined],
    ["diagnostics", diagnostics, undefined],
  ] as const;
  for (const [kind, record, lookup] of groups) {
    for (const entries of partitionRecord(record, kind)) {
      const value = canonicalJson({ kind, entries });
      const sha256 = await hasher.sha256(value);
      const chunk: CatalogChunk = {
        id: `${kind}:${sha256}`,
        kind,
        sha256,
        bytes: utf8Bytes(value),
        value,
      };
      chunks.push(chunk);
      if (lookup) for (const [id] of entries) lookup[id] = sha256;
    }
  }
  const metadataValue = canonicalJson({
    kind: "metadata",
    schemaVersion: catalog.schemaVersion,
    source: catalog.source,
    roots: catalog.roots,
  });
  const metadataSha = await hasher.sha256(metadataValue);
  chunks.push({
    id: `metadata:${metadataSha}`,
    kind: "metadata",
    sha256: metadataSha,
    bytes: utf8Bytes(metadataValue),
    value: metadataValue,
  });
  const descriptors = chunks
    .map((chunk) => ({
      id: chunk.id,
      kind: chunk.kind,
      sha256: chunk.sha256,
      bytes: chunk.bytes,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const contentVersion = await hasher.sha256(
    canonicalJson({
      schemaVersion: catalog.schemaVersion,
      chunks: descriptors,
      entityChunkById,
      placementChunkById,
      slotChunkById,
    }),
  );
  const index: CatalogIndex = {
    schemaVersion: catalog.schemaVersion,
    contentVersion,
    chunks: descriptors,
    entityChunkById: sortRecord(entityChunkById),
    placementChunkById: sortRecord(placementChunkById),
    slotChunkById: sortRecord(slotChunkById),
  };
  return {
    index,
    chunks: Object.fromEntries(
      chunks
        .map((chunk) => [chunk.sha256, chunk.value] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

export async function reconstructDomainCatalog(
  chunked: ChunkedDomainCatalog,
  hasher: ContentHasher,
): Promise<DomainCatalog> {
  const records: Record<
    "entities" | "placements" | "slots" | "aliases" | "diagnostics",
    Record<string, unknown>
  > = {
    entities: {},
    placements: {},
    slots: {},
    aliases: {},
    diagnostics: {},
  };
  let metadata:
    | {
        schemaVersion: DomainCatalog["schemaVersion"];
        source: DomainCatalog["source"];
        roots: DomainCatalog["roots"];
      }
    | undefined;
  for (const descriptor of chunked.index.chunks) {
    const value = chunked.chunks[descriptor.sha256];
    if (
      value === undefined ||
      (await hasher.sha256(value)) !== descriptor.sha256 ||
      utf8Bytes(value) !== descriptor.bytes
    ) {
      throw new Error(`Chunk integrity failure: ${descriptor.id}`);
    }
    const parsed = JSON.parse(value) as {
      kind: CatalogChunk["kind"];
      entries?: readonly [string, unknown][];
    } & typeof metadata;
    if (parsed.kind === "metadata") metadata = parsed;
    else for (const [id, entry] of parsed.entries ?? []) records[parsed.kind][id] = entry;
  }
  if (!metadata) throw new Error("Metadata chunk is missing");
  return {
    schemaVersion: metadata.schemaVersion,
    contentVersion: chunked.index.contentVersion,
    source: metadata.source,
    entities: records.entities as DomainCatalog["entities"],
    placements: records.placements as DomainCatalog["placements"],
    slots: records.slots as DomainCatalog["slots"],
    aliases: records.aliases as DomainCatalog["aliases"],
    roots: metadata.roots,
    diagnostics: Object.entries(records.diagnostics)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, diagnostic]) => diagnostic) as unknown as DomainCatalog["diagnostics"],
  };
}

function partitionRecord(
  record: Readonly<Record<string, unknown>>,
  kind: Exclude<CatalogChunk["kind"], "metadata">,
): readonly (readonly [string, unknown][])[] {
  const partitions: [string, unknown][][] = [];
  let current: [string, unknown][] = [];
  const envelopeBytes = utf8Bytes(canonicalJson({ kind, entries: [] }));
  let currentBytes = envelopeBytes;
  for (const entry of Object.entries(record).sort(([left], [right]) => left.localeCompare(right))) {
    const entryBytes = utf8Bytes(canonicalJson(entry));
    const singleBytes = envelopeBytes + entryBytes;
    if (singleBytes > MAX_CHUNK_BYTES) throw new ChunkBudgetError(kind, singleBytes);
    const candidateBytes = currentBytes + entryBytes + (current.length > 0 ? 1 : 0);
    if (current.length > 0 && candidateBytes > MAX_CHUNK_BYTES) {
      partitions.push(current);
      current = [entry];
      currentBytes = singleBytes;
    } else {
      current.push(entry);
      currentBytes = candidateBytes;
    }
  }
  if (current.length > 0) partitions.push(current);
  return partitions;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)]),
    );
  }
  return value;
}

function sortRecord<Value>(value: Readonly<Record<string, Value>>): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
