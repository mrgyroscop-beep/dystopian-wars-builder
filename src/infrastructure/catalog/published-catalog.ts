import {
  rosterSetupCatalogSchema,
  type RosterSetupGateway,
} from "../../application/rosters/create-roster";
import type { RosterCatalogGateway } from "../../application/rosters/workspace";
import {
  catalogIndexSchema,
  loadDomainCatalog,
  type CatalogIndex,
  type ContentHasher,
  type DomainCatalogRepository,
} from "../../domain/catalog";
import { z } from "zod";

export interface PublishedCatalogClient {
  readonly setupGateway: RosterSetupGateway;
  readonly catalogGateway: RosterCatalogGateway;
}

export function createPublishedCatalogClient(baseUrl = "/catalog"): PublishedCatalogClient {
  const normalizedBase = baseUrl.replace(/\/$/u, "");
  let indexPromise: Promise<CatalogIndex> | undefined;
  let bundlesPromise: Promise<z.infer<typeof bundleManifestSchema>> | undefined;
  const bundlePromises = new Map<string, Promise<Map<string, string>>>();
  const catalogPromises = new Map<string, Promise<Awaited<ReturnType<typeof loadDomainCatalog>>>>();

  const loadIndex = (): Promise<CatalogIndex> => {
    if (!indexPromise)
      indexPromise = fetchJson(`${normalizedBase}/index.json`).then(
        (value) => catalogIndexSchema.parse(value) as CatalogIndex,
      );
    return indexPromise;
  };
  const repository: DomainCatalogRepository = {
    contractVersion: 1,
    async loadIndex(contentVersion) {
      const index = await loadIndex();
      if (index.contentVersion !== contentVersion)
        throw new Error("Requested catalog version is not published");
      return index;
    },
    loadChunk(sha256) {
      bundlesPromise ??= fetchJson(`${normalizedBase}/bundles.json`).then((value) =>
        bundleManifestSchema.parse(value),
      );
      return bundlesPromise.then(async (manifest) => {
        const name = manifest.chunkToBundle[sha256];
        if (!name) throw new Error("Published catalog chunk is not mapped to a bundle");
        let pending = bundlePromises.get(name);
        if (!pending) {
          pending = fetchText(`${normalizedBase}/releases/${manifest.contentVersion}/${name}`).then(
            parseBundle,
          );
          bundlePromises.set(name, pending);
        }
        const value = (await pending).get(sha256);
        if (!value) throw new Error("Published catalog bundle is missing a chunk");
        return value;
      });
    },
  };
  const hasher: ContentHasher = {
    async sha256(value) {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    },
  };

  return {
    setupGateway: {
      contractVersion: 1,
      load: () =>
        fetchJson(`${normalizedBase}/setup.json`).then((value) =>
          rosterSetupCatalogSchema.parse(value),
        ),
    },
    catalogGateway: {
      contractVersion: 1,
      load(contentVersion) {
        let pending = catalogPromises.get(contentVersion);
        if (!pending) {
          pending = loadDomainCatalog(contentVersion, repository, hasher);
          catalogPromises.set(contentVersion, pending);
        }
        return pending;
      },
    },
  };
}

const bundleManifestSchema = z.object({
  schemaVersion: z.literal(1),
  contentVersion: z.string().regex(/^[0-9a-f]{64}$/u),
  files: z.array(
    z.object({
      name: z.string().regex(/^bundle-\d{2}\.ndjson$/u),
      bytes: z
        .number()
        .int()
        .positive()
        .max(25 * 1024 * 1024),
      chunks: z.number().int().positive(),
    }),
  ),
  chunkToBundle: z.record(z.string(), z.string()),
});

function parseBundle(contents: string): Map<string, string> {
  const chunks = new Map<string, string>();
  for (const line of contents.split("\n")) {
    if (!line) continue;
    const separator = line.indexOf("\t");
    if (separator !== 64) throw new Error("Published catalog bundle is malformed");
    const sha256 = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!/^[0-9a-f]{64}$/u.test(sha256) || chunks.has(sha256))
      throw new Error("Published catalog bundle identity is invalid");
    chunks.set(sha256, value);
  }
  return chunks;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Catalog request failed with status ${response.status}`);
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Catalog request failed with status ${response.status}`);
  return response.text();
}
