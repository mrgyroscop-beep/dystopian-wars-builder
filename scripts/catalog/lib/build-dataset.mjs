import { canonicalJson, sha256 } from "./canonical.mjs";
import { CatalogImportError } from "./errors.mjs";
import { parseCatalogSource } from "./parse-xml.mjs";

export async function buildDataset(lock, sources) {
  const byPath = new Map(sources.map((source) => [source.path, source]));
  if (byPath.size !== lock.files.length || lock.files.some((file) => !byPath.has(file.path))) {
    throw new CatalogImportError("SOURCE_SET_MISMATCH", "Source set does not match the lock", {});
  }
  const documents = [];
  for (const locked of lock.files)
    documents.push(await parseCatalogSource(byPath.get(locked.path)));
  validateDocumentMetadata(documents);
  resolveReferences(documents);

  const graph = {
    schemaVersion: 1,
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
  const manifest = {
    schemaVersion: 1,
    contentVersion: graphSha256.slice(0, 20),
    graph: { file: "catalog.json", sha256: graphSha256, bytes: Buffer.byteLength(graphJson) },
    source: {
      repository: lock.repository,
      commit: lock.commit,
      tree: lock.tree,
      files: lock.files.map(({ path, blob, sha256: fileSha256 }) => ({
        path,
        blob,
        sha256: fileSha256,
      })),
    },
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
  for (const document of documents) {
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
      if (source) source.target = candidates[0];
    }
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
