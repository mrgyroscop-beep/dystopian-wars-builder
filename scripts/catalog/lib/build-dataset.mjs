import { canonicalJson, sha256 } from "./canonical.mjs";
import { CatalogImportError } from "./errors.mjs";
import { parseCatalogSource } from "./parse-xml.mjs";

export async function buildDataset(lock, sources, provenance) {
  const byPath = new Map(sources.map((source) => [source.path, source]));
  if (byPath.size !== lock.files.length || lock.files.some((file) => !byPath.has(file.path))) {
    throw new CatalogImportError("SOURCE_SET_MISMATCH", "Source set does not match the lock", {});
  }
  validateProvenance(lock, provenance);
  const documents = [];
  for (const locked of lock.files)
    documents.push(await parseCatalogSource(byPath.get(locked.path)));
  validateDocumentMetadata(documents);
  resolveReferences(documents);

  const graph = {
    schemaVersion: 2,
    documents: documents.map((document) => ({
      path: document.path,
      blob: document.blob,
      sha256: document.sha256,
      root: document.root,
      statistics: document.statistics,
    })),
  };
  const graphJson = canonicalJson(graph);
  const graphSha256 = sha256(graphJson);
  const diagnostics = summarizeDiagnostics(documents);
  const manifest = {
    schemaVersion: 2,
    contentVersion: graphSha256.slice(0, 20),
    graph: { file: "catalog.json", sha256: graphSha256, bytes: Buffer.byteLength(graphJson) },
    source: {
      requested: { repository: lock.repository, commit: lock.commit, tree: lock.tree },
      resolved: {
        repository: provenance.repository,
        commit: provenance.commit,
        tree: provenance.tree,
        commitTimestamp: provenance.commitTimestamp,
      },
      files: lock.files.map(({ path, blob, bytes, sha256: fileSha256 }) => ({
        path,
        blob,
        bytes,
        sha256: fileSha256,
      })),
    },
    importer: {
      name: "dystopian-wars-builder/catalog",
      contractVersion: 2,
      parser: { name: "saxes", version: "6.0.0", mode: "streaming" },
    },
    sanitizer: {
      contractVersion: 2,
      output: "structured-rich-text",
      rawHtml: false,
      plainTextFallback: true,
    },
    license: {
      status: "redistribution-unconfirmed",
      sourceUrl: `https://github.com/${lock.repository}`,
      sourcePayloadPublished: false,
      generatedPayloadPublished: false,
    },
    diagnostics,
    inventory: documents.map((document) => ({
      path: document.path,
      kind: document.root.tag,
      id: document.root.attributes.id,
      name: document.root.attributes.name,
      revision: document.root.attributes.revision,
      ...document.statistics,
    })),
  };
  const manifestJson = canonicalJson(manifest);
  const releaseId = sha256(manifestJson);
  return {
    releaseId,
    files: new Map([
      ["catalog.json", graphJson],
      ["manifest.json", manifestJson],
    ]),
    manifest,
  };
}

function validateProvenance(lock, provenance) {
  if (
    !provenance ||
    provenance.repository !== lock.repository ||
    provenance.commit !== lock.commit ||
    provenance.tree !== lock.tree ||
    provenance.commitTimestamp !== lock.commitTimestamp ||
    !Array.isArray(provenance.files) ||
    provenance.files.length !== lock.files.length
  ) {
    throw new CatalogImportError(
      "PROVENANCE_REQUIRED",
      "Verified source provenance is required to build a catalog",
      {},
    );
  }
  for (const [index, locked] of lock.files.entries()) {
    const resolved = provenance.files[index];
    if (
      resolved?.path !== locked.path ||
      resolved.blob !== locked.blob ||
      resolved.bytes !== locked.bytes
    )
      throw new CatalogImportError(
        "PROVENANCE_REQUIRED",
        "Verified source blob provenance is incomplete",
        { path: locked.path },
      );
  }
}

function validateDocumentMetadata(documents) {
  const gameSystems = documents.filter((document) => document.root.tag === "gameSystem");
  if (gameSystems.length !== 1) {
    throw new CatalogImportError(
      "GAME_SYSTEM_COUNT",
      "Source set must contain exactly one game system",
      { count: gameSystems.length },
    );
  }
  const gameSystemId = gameSystems[0].root.attributes.id;
  if (!gameSystemId)
    throw new CatalogImportError("GAME_SYSTEM_ID", "Game system does not define an id", {});
  for (const document of documents) {
    const { attributes, tag } = document.root;
    if (!attributes.id || !attributes.name || !attributes.revision) {
      throw new CatalogImportError(
        "DOCUMENT_METADATA",
        "Catalog document is missing required metadata",
        { path: document.path },
      );
    }
    if (tag === "catalogue" && attributes.gameSystemId !== gameSystemId) {
      throw new CatalogImportError(
        "GAME_SYSTEM_REFERENCE",
        "Catalog references an unexpected game system",
        {
          path: document.path,
          expected: gameSystemId,
          actual: attributes.gameSystemId,
        },
      );
    }
  }
}

function resolveReferences(documents) {
  const global = new Map();
  const nodes = new Map();
  for (const document of documents) {
    indexNodes(document.root, nodes);
    for (const [id, keys] of Object.entries(document.ids)) {
      const existing = global.get(id) ?? [];
      existing.push(...keys);
      global.set(id, existing);
    }
  }
  for (const document of documents) {
    for (const reference of document.references) {
      const local = document.ids[reference.targetId] ?? [];
      const candidates = local.length > 0 ? local : (global.get(reference.targetId) ?? []);
      if (candidates.length === 0) {
        throw new CatalogImportError("TARGET_UNRESOLVED", "Catalog targetId cannot be resolved", {
          path: document.path,
          sourceKey: reference.sourceKey,
          targetId: reference.targetId,
        });
      }
      if (candidates.length > 1) {
        throw new CatalogImportError(
          "TARGET_AMBIGUOUS",
          "Catalog targetId resolves to multiple nodes",
          {
            path: document.path,
            sourceKey: reference.sourceKey,
            targetId: reference.targetId,
            candidates,
          },
        );
      }
      reference.resolvedKey = candidates[0];
      const source = findNode(document.root, reference.sourceKey);
      const target = nodes.get(candidates[0]);
      validateLinkKind(document.path, source, target);
      if (source) source.target = candidates[0];
    }
  }
}

export function validateLinkKind(documentPath, source, target) {
  const exactKinds = {
    catalogueLink: source?.attributes.type === "catalogue" ? "catalogue" : undefined,
    categoryLink: source && !Object.hasOwn(source.attributes, "type") ? "categoryEntry" : undefined,
    entryLink: new Set(["selectionEntry", "selectionEntryGroup"]).has(source?.attributes.type)
      ? source.attributes.type
      : undefined,
    infoLink: new Set(["profile", "rule"]).has(source?.attributes.type)
      ? source.attributes.type
      : undefined,
  };
  const expected = exactKinds[source?.tag];
  if (!Object.hasOwn(exactKinds, source?.tag) || !expected) {
    throw new CatalogImportError("LINK_TYPE_INVALID", "Catalog link type is not supported", {
      path: documentPath,
      sourceKey: source?.key,
      link: source?.tag,
      type: source?.attributes.type,
    });
  }
  if (target?.tag !== expected) {
    throw new CatalogImportError("LINK_TARGET_KIND", "Catalog link points to the wrong node kind", {
      path: documentPath,
      sourceKey: source?.key,
      expected,
      actual: target?.tag,
    });
  }
}

function indexNodes(node, nodes) {
  nodes.set(node.key, node);
  for (const child of node.children ?? []) indexNodes(child, nodes);
}

function summarizeDiagnostics(documents) {
  const counts = new Map();
  let contentUnavailable = 0;
  for (const document of documents) visit(document.root);
  return {
    contractVersion: 1,
    meaningfulLoss: [...counts.values()].reduce((sum, count) => sum + count, 0),
    contentUnavailable,
    codes: Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right))),
  };

  function visit(node) {
    if (node.richText?.contentUnavailable) contentUnavailable += 1;
    for (const diagnostic of node.richText?.diagnostics ?? [])
      counts.set(diagnostic.code, (counts.get(diagnostic.code) ?? 0) + 1);
    for (const child of node.children ?? []) visit(child);
  }
}

function findNode(node, key) {
  if (node.key === key) return node;
  for (const child of node.children ?? []) {
    const match = findNode(child, key);
    if (match) return match;
  }
  return undefined;
}
