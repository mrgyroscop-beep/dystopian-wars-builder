import type {
  CatalogChunk,
  CatalogIndex,
  ChunkedDomainCatalog,
  ContentHasher,
  DomainCatalog,
  DomainCatalogRepository,
  DomainCatalogWriter,
} from "./types";
import { catalogChunkPayloadSchema, catalogIndexSchema, domainCatalogSchema } from "./schemas";

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

  for (const partition of await partitionEntityRecord(catalog.entities, hasher)) {
    const value = canonicalJson({
      kind: "entities",
      bucket: partition.bucket,
      entries: partition.entries,
    });
    const sha256 = await hasher.sha256(value);
    chunks.push({
      id: `entities:${partition.bucket}:${sha256}`,
      kind: "entities",
      bucket: partition.bucket,
      sha256,
      bytes: utf8Bytes(value),
      value,
    });
    for (const [id] of partition.entries) entityChunkById[id] = sha256;
  }

  const groups = [
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
  const coreValue = canonicalJson({
    kind: "core",
    roots: catalog.roots,
    entityIds: Object.values(catalog.entities)
      .filter((entity) => entity.kind === "GameSystem")
      .map((entity) => entity.id)
      .sort(),
  });
  const coreSha = await appendViewChunk(chunks, "core", coreValue, hasher);
  const glossaryValue = canonicalJson({
    kind: "glossary",
    entityIds: Object.values(catalog.entities)
      .filter((entity) => entity.kind === "Rule")
      .map((entity) => entity.id)
      .sort(),
  });
  const glossarySha = await appendViewChunk(chunks, "glossary", glossaryValue, hasher);
  const factionIndexChunks: Record<string, string> = {};
  const factionDocumentPaths = new Set(
    Object.values(catalog.entities)
      .filter((entity) => new Set(["Battlefleet", "Unit", "Model"]).has(entity.kind))
      .map((entity) => entity.provenance.documentPath),
  );
  for (const faction of Object.values(catalog.entities)
    .filter(
      (entity) =>
        entity.kind === "Faction" && factionDocumentPaths.has(entity.provenance.documentPath),
    )
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const value = canonicalJson({
      kind: "faction-index",
      factionId: faction.id,
      entityIds: Object.values(catalog.entities)
        .filter((entity) => entity.provenance.documentPath === faction.provenance.documentPath)
        .map((entity) => entity.id)
        .sort(),
    });
    factionIndexChunks[faction.id] = await appendViewChunk(chunks, "faction-index", value, hasher);
  }
  const views = {
    coreChunk: coreSha,
    glossaryChunk: glossarySha,
    factionIndexChunks: sortRecord(factionIndexChunks),
  };
  const descriptors = chunks
    .map((chunk) => ({
      id: chunk.id,
      kind: chunk.kind,
      ...(chunk.bucket ? { bucket: chunk.bucket } : {}),
      sha256: chunk.sha256,
      bytes: chunk.bytes,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const contentVersion = await contentVersionOf(
    catalog.schemaVersion,
    descriptors,
    entityChunkById,
    placementChunkById,
    slotChunkById,
    views,
    2,
    catalog.source.commit,
    hasher,
  );
  const index: CatalogIndex = {
    format: "dwb-domain-catalog",
    manifestVersion: 1,
    schemaVersion: catalog.schemaVersion,
    contentVersion,
    sourceSchemaVersion: 2,
    sourceCommit: catalog.source.commit,
    chunks: descriptors,
    entityChunkById: sortRecord(entityChunkById),
    placementChunkById: sortRecord(placementChunkById),
    slotChunkById: sortRecord(slotChunkById),
    views,
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
  validateDescriptors(chunked);
  const expectedContentVersion = await contentVersionOf(
    chunked.index.schemaVersion,
    chunked.index.chunks,
    chunked.index.entityChunkById,
    chunked.index.placementChunkById,
    chunked.index.slotChunkById,
    chunked.index.views,
    chunked.index.sourceSchemaVersion,
    chunked.index.sourceCommit,
    hasher,
  );
  if (expectedContentVersion !== chunked.index.contentVersion)
    throw new Error("Catalog index content version mismatch");
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
  const usedChunks = new Set<string>();
  for (const descriptor of chunked.index.chunks) {
    const value = chunked.chunks[descriptor.sha256];
    if (
      value === undefined ||
      (await hasher.sha256(value)) !== descriptor.sha256 ||
      utf8Bytes(value) !== descriptor.bytes
    ) {
      throw new Error(`Chunk integrity failure: ${descriptor.id}`);
    }
    usedChunks.add(descriptor.sha256);
    const parsedPayload = catalogChunkPayloadSchema.safeParse(JSON.parse(value));
    if (!parsedPayload.success)
      throw new Error(`Chunk payload schema is invalid: ${descriptor.id}`);
    const parsed = parsedPayload.data;
    if (parsed.kind !== descriptor.kind)
      throw new Error(`Chunk descriptor kind mismatch: ${descriptor.id}`);
    if (parsed.kind === "entities") {
      if (parsed.bucket !== descriptor.bucket)
        throw new Error(`Chunk descriptor bucket mismatch: ${descriptor.id}`);
      for (const [id] of parsed.entries) {
        const identityHash = await hasher.sha256(`entity-id:${id}`);
        if (!identityHash.startsWith(parsed.bucket))
          throw new Error(`Entity is stored in the wrong hash bucket: ${id}`);
      }
    }
    if (parsed.kind === "metadata") {
      if (metadata) throw new Error("Multiple metadata chunks are not allowed");
      metadata = {
        schemaVersion: parsed.schemaVersion,
        source: parsed.source,
        roots: parsed.roots as unknown as DomainCatalog["roots"],
      };
    } else if (
      parsed.kind === "core" ||
      parsed.kind === "glossary" ||
      parsed.kind === "faction-index"
    ) {
      continue;
    } else {
      const parsedEntries: unknown = parsed.entries;
      if (!Array.isArray(parsedEntries)) throw new Error(`Chunk entries missing: ${descriptor.id}`);
      for (const candidate of parsedEntries as readonly unknown[]) {
        if (!Array.isArray(candidate) || candidate.length !== 2)
          throw new Error(`Chunk entry is malformed: ${descriptor.id}`);
        const candidateId: unknown = candidate[0];
        const entry: unknown = candidate[1];
        if (typeof candidateId !== "string")
          throw new Error(`Chunk entry identity is malformed: ${descriptor.id}`);
        const id = candidateId;
        if (Object.hasOwn(records[parsed.kind], id))
          throw new Error(`Duplicate record identity: ${id}`);
        records[parsed.kind][id] = entry;
      }
    }
  }
  const extras = Object.keys(chunked.chunks).filter((sha) => !usedChunks.has(sha));
  if (extras.length > 0) throw new Error(`Unreferenced chunks in repository: ${extras.join(",")}`);
  if (!metadata) throw new Error("Metadata chunk is missing");
  if (metadata.schemaVersion !== chunked.index.schemaVersion)
    throw new Error("Metadata/index schema mismatch");
  if (metadata.source.commit !== chunked.index.sourceCommit)
    throw new Error("Metadata/index source commit mismatch");
  validateLookup("entity", "entities", records.entities, chunked.index.entityChunkById, chunked);
  validateLookup(
    "placement",
    "placements",
    records.placements,
    chunked.index.placementChunkById,
    chunked,
  );
  validateLookup("slot", "slots", records.slots, chunked.index.slotChunkById, chunked);
  const catalog = {
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
  validateSchemaContracts(catalog);
  validateClosure(catalog);
  validateViews(chunked, catalog);
  return catalog;
}

export async function persistChunkedCatalog(
  chunked: ChunkedDomainCatalog,
  writer: DomainCatalogWriter,
): Promise<void> {
  validateDescriptors(chunked);
  for (const descriptor of [...chunked.index.chunks].sort((a, b) => a.id.localeCompare(b.id))) {
    const value = chunked.chunks[descriptor.sha256];
    if (value === undefined) throw new Error(`Chunk payload missing: ${descriptor.id}`);
    await writer.writeChunk(descriptor.sha256, value);
  }
  await writer.writeIndex(chunked.index);
}

export async function loadDomainCatalog(
  contentVersion: string,
  repository: DomainCatalogRepository,
  hasher: ContentHasher,
): Promise<DomainCatalog> {
  const index = await repository.loadIndex(contentVersion);
  if (index.contentVersion !== contentVersion)
    throw new Error("Repository returned an index for a different content version");
  const chunks: Record<string, string> = {};
  for (const descriptor of index.chunks)
    chunks[descriptor.sha256] = await repository.loadChunk(descriptor.sha256);
  return reconstructDomainCatalog({ index, chunks }, hasher);
}

async function contentVersionOf(
  schemaVersion: CatalogIndex["schemaVersion"],
  chunks: CatalogIndex["chunks"],
  entityChunkById: CatalogIndex["entityChunkById"],
  placementChunkById: CatalogIndex["placementChunkById"],
  slotChunkById: CatalogIndex["slotChunkById"],
  views: CatalogIndex["views"],
  sourceSchemaVersion: CatalogIndex["sourceSchemaVersion"],
  sourceCommit: CatalogIndex["sourceCommit"],
  hasher: ContentHasher,
): Promise<string> {
  return hasher.sha256(
    canonicalJson({
      format: "dwb-domain-catalog",
      manifestVersion: 1,
      schemaVersion,
      sourceSchemaVersion,
      sourceCommit,
      chunks,
      entityChunkById,
      placementChunkById,
      slotChunkById,
      views,
    }),
  );
}

function validateDescriptors(chunked: ChunkedDomainCatalog): void {
  const parsedIndex = catalogIndexSchema.safeParse(chunked.index);
  if (!parsedIndex.success)
    throw new Error(
      `Catalog index schema is invalid: ${parsedIndex.error.issues[0]?.message ?? "unknown"}`,
    );
  const ids = new Set<string>();
  const hashes = new Set<string>();
  for (const descriptor of chunked.index.chunks) {
    const expectedId = descriptor.bucket
      ? `${descriptor.kind}:${descriptor.bucket}:${descriptor.sha256}`
      : `${descriptor.kind}:${descriptor.sha256}`;
    if (descriptor.id !== expectedId)
      throw new Error(`Invalid chunk descriptor identity: ${descriptor.id}`);
    if ((descriptor.kind === "entities") !== Boolean(descriptor.bucket))
      throw new Error(`Invalid entity bucket descriptor: ${descriptor.id}`);
    if (!/^[0-9a-f]{64}$/u.test(descriptor.sha256))
      throw new Error(`Invalid chunk descriptor hash: ${descriptor.id}`);
    if (
      !Number.isSafeInteger(descriptor.bytes) ||
      descriptor.bytes < 0 ||
      descriptor.bytes > MAX_CHUNK_BYTES
    )
      throw new Error(`Invalid chunk descriptor byte budget: ${descriptor.id}`);
    if (ids.has(descriptor.id) || hashes.has(descriptor.sha256))
      throw new Error(`Duplicate chunk descriptor: ${descriptor.id}`);
    ids.add(descriptor.id);
    hashes.add(descriptor.sha256);
  }
}

function validateViews(chunked: ChunkedDomainCatalog, catalog: DomainCatalog): void {
  const kindByHash = new Map(chunked.index.chunks.map((chunk) => [chunk.sha256, chunk.kind]));
  if (kindByHash.get(chunked.index.views.coreChunk) !== "core")
    throw new Error("Core view descriptor is missing");
  if (kindByHash.get(chunked.index.views.glossaryChunk) !== "glossary")
    throw new Error("Glossary view descriptor is missing");
  const parsedCore = catalogChunkPayloadSchema.parse(
    JSON.parse(chunked.chunks[chunked.index.views.coreChunk]!),
  );
  if (
    parsedCore.kind !== "core" ||
    canonicalJson(parsedCore.roots) !== canonicalJson(catalog.roots)
  )
    throw new Error("Core view roots mismatch");
  const expectedCoreIds = Object.values(catalog.entities)
    .filter((entity) => entity.kind === "GameSystem")
    .map((entity) => entity.id)
    .sort();
  if (canonicalJson(parsedCore.entityIds) !== canonicalJson(expectedCoreIds))
    throw new Error("Core view entity coverage mismatch");
  const glossary = catalogChunkPayloadSchema.parse(
    JSON.parse(chunked.chunks[chunked.index.views.glossaryChunk]!),
  );
  if (glossary.kind !== "glossary") throw new Error("Glossary view payload mismatch");
  const expectedGlossaryIds = Object.values(catalog.entities)
    .filter((entity) => entity.kind === "Rule")
    .map((entity) => entity.id)
    .sort();
  if (canonicalJson(glossary.entityIds) !== canonicalJson(expectedGlossaryIds))
    throw new Error("Glossary view entity coverage mismatch");
  const factionDocumentPaths = new Set(
    Object.values(catalog.entities)
      .filter((entity) => new Set(["Battlefleet", "Unit", "Model"]).has(entity.kind))
      .map((entity) => entity.provenance.documentPath),
  );
  const expectedFactionIds = Object.values(catalog.entities)
    .filter(
      (entity) =>
        entity.kind === "Faction" && factionDocumentPaths.has(entity.provenance.documentPath),
    )
    .map((entity) => entity.id)
    .sort();
  if (
    canonicalJson(Object.keys(chunked.index.views.factionIndexChunks).sort()) !==
    canonicalJson(expectedFactionIds)
  )
    throw new Error("Faction view index coverage mismatch");
  for (const [factionId, sha] of Object.entries(chunked.index.views.factionIndexChunks)) {
    if (kindByHash.get(sha) !== "faction-index")
      throw new Error(`Faction view descriptor is missing: ${factionId}`);
    const faction = catalog.entities[factionId];
    const view = catalogChunkPayloadSchema.parse(JSON.parse(chunked.chunks[sha]!));
    if (
      faction?.kind !== "Faction" ||
      view.kind !== "faction-index" ||
      view.factionId !== factionId
    )
      throw new Error(`Faction view payload mismatch: ${factionId}`);
    const expectedIds = Object.values(catalog.entities)
      .filter((entity) => entity.provenance.documentPath === faction.provenance.documentPath)
      .map((entity) => entity.id)
      .sort();
    if (canonicalJson(view.entityIds) !== canonicalJson(expectedIds))
      throw new Error(`Faction view coverage mismatch: ${factionId}`);
  }
}

function validateLookup(
  label: string,
  expectedKind: CatalogChunk["kind"],
  record: Readonly<Record<string, unknown>>,
  lookup: Readonly<Record<string, string>>,
  chunked: ChunkedDomainCatalog,
): void {
  const recordIds = Object.keys(record).sort();
  const lookupIds = Object.keys(lookup).sort();
  if (canonicalJson(recordIds) !== canonicalJson(lookupIds))
    throw new Error(`${label} lookup coverage mismatch`);
  const idsByChunk = new Map<string, ReadonlySet<string>>();
  const descriptorByHash = new Map(
    chunked.index.chunks.map((descriptor) => [descriptor.sha256, descriptor]),
  );
  for (const sha of new Set(Object.values(lookup))) {
    if (descriptorByHash.get(sha)?.kind !== expectedKind)
      throw new Error(`${label} lookup points to the wrong chunk kind`);
    const value = chunked.chunks[sha];
    const parsed = value ? (JSON.parse(value) as { entries?: readonly [string, unknown][] }) : null;
    idsByChunk.set(sha, new Set((parsed?.entries ?? []).map(([id]) => id)));
  }
  for (const id of recordIds) {
    const sha = lookup[id]!;
    if (!idsByChunk.get(sha)?.has(id))
      throw new Error(`${label} lookup points to the wrong chunk: ${id}`);
  }
}

function validateClosure(catalog: DomainCatalog): void {
  const hasEntity = (id: string, relation: string): void => {
    if (!catalog.entities[id])
      throw new Error(`Catalog reference closure failure (${relation}): ${id}`);
  };
  for (const root of catalog.roots) hasEntity(root, "root");
  for (const entity of Object.values(catalog.entities)) {
    for (const [relation, ids] of Object.entries({
      categoryIds: entity.categoryIds,
      costIds: entity.costIds,
      constraintIds: entity.constraintIds,
      conditionIds: entity.conditionIds,
      modifierIds: entity.modifierIds,
      repeatIds: entity.repeatIds,
      profileIds: entity.profileIds,
      ruleIds: entity.ruleIds,
    }))
      for (const id of ids) hasEntity(id, relation);
    for (const id of entity.slotIds)
      if (!catalog.slots[id]) throw new Error(`Catalog reference closure failure (slot): ${id}`);
    if ("expression" in entity)
      for (const resolution of entity.expression.referenceResolutions) {
        if (resolution.state === "resolved")
          hasEntity(resolution.entityId, "expression resolution");
        if (resolution.state === "ambiguous")
          for (const id of resolution.candidateEntityIds) hasEntity(id, "expression candidates");
      }
  }
  for (const placement of Object.values(catalog.placements)) {
    hasEntity(placement.ownerId, "placement owner");
    if (placement.definitionId) hasEntity(placement.definitionId, "placement definition");
    if (placement.slotId && !catalog.slots[placement.slotId])
      throw new Error(`Catalog reference closure failure (placement slot): ${placement.slotId}`);
    if (placement.resolution?.state === "resolved")
      hasEntity(placement.resolution.entityId, "placement resolution");
    if (placement.resolution?.state === "ambiguous")
      for (const id of placement.resolution.candidateEntityIds)
        hasEntity(id, "placement candidates");
  }
  for (const slot of Object.values(catalog.slots)) {
    hasEntity(slot.ownerId, "slot owner");
    for (const id of slot.placementIds)
      if (!catalog.placements[id])
        throw new Error(`Catalog reference closure failure (slot placement): ${id}`);
  }
  for (const alias of Object.values(catalog.aliases))
    for (const id of alias.entityIds) hasEntity(id, "alias");
}

function validateSchemaContracts(catalog: DomainCatalog): void {
  const parsed = domainCatalogSchema.safeParse(catalog);
  if (!parsed.success)
    throw new Error(
      `Catalog domain schema is invalid: ${parsed.error.issues[0]?.path.join(".") ?? "root"}`,
    );
  if (catalog.schemaVersion !== "1.0.0") throw new Error("Catalog schema version is unsupported");
  const expressionKinds = new Set([
    "Constraint",
    "ConditionGroup",
    "Condition",
    "Modifier",
    "Repeat",
  ]);
  for (const [recordId, entity] of Object.entries(catalog.entities)) {
    if (
      entity.id !== recordId ||
      entity.identity.canonicalId !== entity.id ||
      entity.identity.sourceNodeId !== entity.provenance.sourceNodeId ||
      entity.identity.quality !== entity.identityQuality
    )
      throw new Error(`Entity identity contract is inconsistent: ${recordId}`);
    if (entity.contractVersion !== 1)
      throw new Error(`Entity contract version is unsupported: ${entity.id}`);
    if (
      entity.kind === "Cost" &&
      (entity.amount.contractVersion !== 1 ||
        canonicalJson(entity.amount) !== canonicalJson(entity.semantics.amount))
    )
      throw new Error(`Cost amount schema is invalid: ${entity.id}`);
    if (
      expressionKinds.has(entity.kind) &&
      (!("expression" in entity) || entity.expression.contractVersion !== 1)
    )
      throw new Error(`Expression schema is invalid: ${entity.id}`);
    if (
      entity.fields.some((field) => field.contractVersion !== 1) ||
      entity.extensions.some((extension) => !validExtensionContract(extension))
    )
      throw new Error(`Nested entity contract version is unsupported: ${entity.id}`);
  }
  for (const [recordId, placement] of Object.entries(catalog.placements))
    if (placement.id !== recordId || placement.contractVersion !== 1)
      throw new Error(`Placement contract version is unsupported: ${placement.id}`);
  for (const [recordId, slot] of Object.entries(catalog.slots))
    if (
      slot.id !== recordId ||
      slot.contractVersion !== 1 ||
      slot.semantics.contractVersion !== 1 ||
      canonicalJson(slot.optionPlacementIds) !== canonicalJson(slot.placementIds)
    )
      throw new Error(`Slot contract version is unsupported: ${slot.id}`);
  for (const [recordId, alias] of Object.entries(catalog.aliases))
    if (alias.alias !== recordId || alias.contractVersion !== 1)
      throw new Error(`Alias contract version is unsupported: ${alias.alias}`);
}

async function appendViewChunk(
  chunks: CatalogChunk[],
  kind: "core" | "glossary" | "faction-index",
  value: string,
  hasher: ContentHasher,
): Promise<string> {
  const bytes = utf8Bytes(value);
  if (bytes > MAX_CHUNK_BYTES) throw new ChunkBudgetError(kind, bytes);
  const sha256 = await hasher.sha256(value);
  chunks.push({ id: `${kind}:${sha256}`, kind, sha256, bytes, value });
  return sha256;
}

async function partitionEntityRecord(
  record: Readonly<Record<string, unknown>>,
  hasher: ContentHasher,
): Promise<readonly { readonly bucket: string; readonly entries: readonly [string, unknown][] }[]> {
  const annotated = await Promise.all(
    Object.entries(record)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(async (entry) => ({ entry, hash: await hasher.sha256(`entity-id:${entry[0]}`) })),
  );
  const result: { bucket: string; entries: [string, unknown][] }[] = [];
  const split = (values: typeof annotated, prefixLength: number): void => {
    const groups = new Map<string, typeof annotated>();
    for (const value of values) {
      const bucket = value.hash.slice(0, prefixLength);
      groups.set(bucket, [...(groups.get(bucket) ?? []), value]);
    }
    for (const [bucket, members] of [...groups].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      const entries = members.map((member) => member.entry);
      const bytes = utf8Bytes(canonicalJson({ kind: "entities", bucket, entries }));
      if (bytes <= MAX_CHUNK_BYTES) {
        result.push({ bucket, entries });
        continue;
      }
      if (members.length === 1) throw new ChunkBudgetError("entities", bytes);
      if (prefixLength < 64) split(members, prefixLength + 2);
      else {
        for (const partition of partitionRecord(Object.fromEntries(entries), "entities"))
          result.push({ bucket, entries: [...partition] });
      }
    }
  };
  split(annotated, 2);
  return result;
}

function validExtensionContract(
  extension: DomainCatalog["entities"][string]["extensions"][number],
): boolean {
  return extension.contractVersion === 1 && extension.children.every(validExtensionContract);
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
