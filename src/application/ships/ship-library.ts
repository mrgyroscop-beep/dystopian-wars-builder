import type { RosterSetupCatalog } from "../rosters/create-roster";
import { fleetCategories, type FleetCategory } from "../rosters/workspace";
import { projectShipEditor, type ShipEditorReadyReadModel } from "../rosters/ship-editor";
import type { DomainCatalog, DomainEntity } from "../../domain/catalog";
import type { RosterSnapshot } from "../../domain/roster";
import cardManifest from "../../assets/orbat-card-manifest.json";

export interface ShipLibraryDependencies {
  readonly setupGateway: { load(contentVersion?: string): Promise<RosterSetupCatalog> };
  readonly catalogGateway: {
    load(contentVersion: string, factionId?: string): Promise<DomainCatalog>;
  };
}

export interface ShipLibraryFaction {
  readonly id: string;
  readonly label: string;
  readonly shipCount: number;
}

const publishedShipCounts: Readonly<Record<string, number>> = {
  alliance: 44,
  commonwealth: 17,
  crown: 49,
  empire: 53,
  enlightened: 40,
  imperium: 9,
  sultanate: 42,
  union: 15,
};

export interface ShipLibraryItem {
  readonly id: string;
  readonly name: string;
  readonly category: FleetCategory;
  readonly role: string;
  readonly platform: string;
  readonly points: string;
  readonly victoryPoints: string;
  readonly orbatPageUrl: string;
}

export interface ShipLibrarySession {
  readonly contentVersion: string;
  readonly faction: ShipLibraryFaction;
  readonly ships: readonly ShipLibraryItem[];
}

export interface ShipLibraryCatalog {
  readonly session: ShipLibrarySession;
  profile(definitionId: string): ShipEditorReadyReadModel | null;
}

const cards = cardManifest.cards as Record<string, Record<string, string> | undefined>;
const fixtureAliases: Readonly<Record<string, Record<string, string> | undefined>> = {
  empire: { akitademonstrator: "/orbat-cards/empire/23.webp" },
};

export async function listShipLibraryFactions(
  dependencies: ShipLibraryDependencies,
): Promise<readonly ShipLibraryFaction[]> {
  const setup = await dependencies.setupGateway.load();
  return setup.factions.map((faction) => ({
    id: faction.id,
    label: faction.label,
    shipCount: publishedShipCounts[compact(faction.label)] ?? 0,
  }));
}

export async function openShipLibrary(
  factionId: string,
  dependencies: ShipLibraryDependencies,
): Promise<ShipLibraryCatalog | null> {
  const setup = await dependencies.setupGateway.load();
  const setupFaction = setup.factions.find((faction) => faction.id === factionId);
  if (!setupFaction) return null;
  const catalog = await dependencies.catalogGateway.load(setup.contentVersion, factionId);
  const factionSlug = compact(setupFaction.label);
  const mappedCards = cards[factionSlug] ?? {};
  const ships = libraryUnits(catalog, mappedCards, fixtureAliases[factionSlug] ?? {}).flatMap(
    (entity) => {
      const key = compact(entity.label.plainText);
      const orbatPageUrl = mappedCards[key] ?? fixtureAliases[factionSlug]?.[key];
      if (!orbatPageUrl) return [];
      const categories = entity.categoryIds
        .map((id) => catalog.entities[id]?.label.plainText ?? "")
        .filter(Boolean);
      return [
        {
          id: entity.id,
          name: entity.label.plainText || entity.labels.fallbackLabel,
          category: categoryFor(entity, categories),
          role: entity.attributes.role || categories[0] || "Ship",
          platform: entity.attributes.platform || platformFor(categories),
          points: entityCost(entity, catalog, "points"),
          victoryPoints: entityCost(entity, catalog, "victory-points"),
          orbatPageUrl,
        } satisfies ShipLibraryItem,
      ];
    },
  );
  const session = {
    contentVersion: setup.contentVersion,
    faction: { id: setupFaction.id, label: setupFaction.label, shipCount: ships.length },
    ships: ships.sort(
      (left, right) => left.name.localeCompare(right.name, "en") || left.id.localeCompare(right.id),
    ),
  } satisfies ShipLibrarySession;
  return {
    session,
    profile(definitionId) {
      const projected = projectShipEditor(
        emptySnapshot(setup.contentVersion, factionId),
        catalog,
        null,
        definitionId,
        "saved-local",
      );
      return projected.dataState === "ready" ? projected : null;
    },
  };
}

export function filterShipLibrary(
  ships: readonly ShipLibraryItem[],
  query: string,
  category: FleetCategory | "all",
  priceOrder: "ascending" | "descending",
): readonly ShipLibraryItem[] {
  const normalized = query.normalize("NFC").trim().toLocaleLowerCase("ru");
  return ships
    .filter((ship) => {
      if (category !== "all" && ship.category !== category) return false;
      if (!normalized) return true;
      return [ship.name, ship.role, ship.platform, ship.category]
        .join(" ")
        .toLocaleLowerCase("ru")
        .includes(normalized);
    })
    .sort((left, right) => {
      const price = numericPrice(left.points) - numericPrice(right.points);
      const orderedPrice = priceOrder === "ascending" ? price : -price;
      return orderedPrice || left.name.localeCompare(right.name, "en");
    });
}

function libraryUnits(
  catalog: DomainCatalog,
  mappedCards: Readonly<Record<string, string>>,
  aliases: Readonly<Record<string, string>>,
): DomainEntity[] {
  return Object.values(catalog.entities).filter(
    (entity) =>
      entity.kind === "Unit" &&
      Boolean(
        mappedCards[compact(entity.label.plainText)] ?? aliases[compact(entity.label.plainText)],
      ),
  );
}

function categoryFor(entity: DomainEntity, categories: readonly string[]): FleetCategory {
  const source = [entity.attributes.category, ...categories].join(" ").toLocaleLowerCase("en");
  return (
    fleetCategories.find((category) =>
      source.includes(category === "Logistical" ? "logistic" : category.toLocaleLowerCase("en")),
    ) ?? "Другое"
  );
}

function platformFor(categories: readonly string[]): string {
  const source = categories.join(" ").toLocaleLowerCase("en");
  if (source.includes("airborne") || source.includes("rotor")) return "Airborne";
  if (source.includes("underwater") || source.includes("submarine")) return "Underwater";
  return "Surface";
}

function numericPrice(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

function entityCost(
  entity: DomainEntity,
  catalog: DomainCatalog,
  resource: "points" | "victory-points",
): string {
  let total = costTotal(entity.costIds, catalog, resource);
  const modelPlacement = Object.values(catalog.placements)
    .filter(
      (placement) =>
        placement.ownerId === entity.id &&
        placement.definitionId &&
        catalog.entities[placement.definitionId]?.kind === "Model",
    )
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))[0];
  if (modelPlacement?.definitionId) {
    const model = catalog.entities[modelPlacement.definitionId];
    const minimum = cardinalityNumber(modelPlacement.overlay.cardinality?.minimum) ?? 1;
    total +=
      minimum *
      costTotal([...(model?.costIds ?? []), ...modelPlacement.overlay.costIds], catalog, resource);
  }
  return String(Number.isInteger(total) ? total : Number(total.toFixed(6)));
}

function costTotal(
  ids: readonly string[],
  catalog: DomainCatalog,
  resource: "points" | "victory-points",
): number {
  return ids.reduce((sum, id) => {
    const cost = catalog.entities[id];
    if (cost?.kind !== "Cost" || cost.semantics.resource !== resource) return sum;
    if (cost.amount.state === "zero") return sum;
    return cost.amount.state === "value" ? sum + Number(cost.amount.value) : sum;
  }, 0);
}

function cardinalityNumber(
  value: { readonly state: string; readonly value?: string } | undefined,
): number | null {
  if (!value) return null;
  if (value.state === "zero") return 0;
  if (value.state !== "value" || value.value === undefined) return null;
  const parsed = Number(value.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptySnapshot(contentVersion: string, factionId: string): RosterSnapshot {
  return {
    contractVersion: 1,
    id: `ship-library-${safeToken(factionId)}`,
    catalogContentVersion: contentVersion,
    rootInstanceIds: [],
    instances: {},
  };
}

function safeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/gu, "-").slice(0, 80) || "faction";
}

function compact(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, "");
}
