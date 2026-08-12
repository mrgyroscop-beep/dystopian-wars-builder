import { z } from "zod";

import {
  rosterSetupCatalogSchema,
  type RosterSetupGateway,
} from "../../application/rosters/create-roster";
import type { RosterCatalogGateway } from "../../application/rosters/workspace";
import { DOMAIN_SCHEMA_VERSION, type DomainCatalog } from "../../domain/catalog";

export interface PublishedCatalogClient {
  readonly setupGateway: RosterSetupGateway;
  readonly catalogGateway: RosterCatalogGateway;
}

const factionManifestSchema = z.object({
  schemaVersion: z.literal(1),
  contentVersion: z.string().regex(/^[0-9a-f]{64}$/u),
  factions: z.record(
    z.string(),
    z.object({
      label: z.string().min(1),
      path: z.string().regex(/^releases\/[0-9a-f]{64}\/factions\/[a-z0-9-]+\.json\.gz$/u),
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      bytes: z
        .number()
        .int()
        .positive()
        .max(25 * 1024 * 1024),
      decodedBytes: z.number().int().positive(),
      entities: z.number().int().positive(),
    }),
  ),
});

export function createPublishedCatalogClient(baseUrl = "/catalog"): PublishedCatalogClient {
  const normalizedBase = baseUrl.replace(/\/$/u, "");
  let manifestPromise: Promise<z.infer<typeof factionManifestSchema>> | undefined;
  const catalogPromises = new Map<string, Promise<DomainCatalog>>();

  const loadManifest = () => {
    manifestPromise ??= fetchJson(`${normalizedBase}/factions.json`).then((value) =>
      factionManifestSchema.parse(value),
    );
    return manifestPromise;
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
      load(contentVersion, factionId) {
        if (!factionId) return Promise.reject(new Error("Roster faction is required"));
        const key = `${contentVersion}:${factionId}`;
        let pending = catalogPromises.get(key);
        if (!pending) {
          pending = loadFactionCatalog(normalizedBase, contentVersion, factionId, loadManifest());
          catalogPromises.set(key, pending);
        }
        return pending;
      },
    },
  };
}

async function loadFactionCatalog(
  baseUrl: string,
  contentVersion: string,
  factionId: string,
  manifestPromise: Promise<z.infer<typeof factionManifestSchema>>,
): Promise<DomainCatalog> {
  const manifest = await manifestPromise;
  if (manifest.contentVersion !== contentVersion)
    throw new Error("Requested catalog version is not published");
  const asset = manifest.factions[factionId];
  if (!asset) throw new Error("Requested faction catalog is not published");
  const compressed = await fetchBinary(`${baseUrl}/${asset.path}`);
  const alreadyDecoded = compressed.byteLength === asset.decodedBytes;
  if (!alreadyDecoded && compressed.byteLength !== asset.bytes)
    throw new Error("Faction catalog size does not match its manifest");
  const contents = alreadyDecoded
    ? new TextDecoder().decode(compressed)
    : await decompressGzip(compressed);
  if (new TextEncoder().encode(contents).byteLength !== asset.decodedBytes)
    throw new Error("Decoded faction catalog size does not match its manifest");
  if ((await sha256(contents)) !== asset.sha256)
    throw new Error("Faction catalog integrity check failed");
  const catalog = JSON.parse(contents) as Partial<DomainCatalog>;
  if (
    catalog.schemaVersion !== DOMAIN_SCHEMA_VERSION ||
    catalog.contentVersion !== contentVersion ||
    catalog.source?.commit === undefined ||
    !catalog.entities ||
    !catalog.placements ||
    !catalog.slots ||
    !catalog.aliases ||
    !catalog.roots ||
    !catalog.diagnostics
  ) {
    throw new Error("Faction catalog contract is invalid");
  }
  return catalog as DomainCatalog;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`Catalog request failed with status ${response.status}`);
  return response.json();
}

async function fetchBinary(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { headers: { Accept: "application/gzip" } });
  if (!response.ok) throw new Error(`Catalog request failed with status ${response.status}`);
  return response.arrayBuffer();
}

async function decompressGzip(value: ArrayBuffer): Promise<string> {
  if (typeof DecompressionStream === "undefined")
    throw new Error("This browser cannot decompress the faction catalog");
  const stream = new Blob([value]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}
