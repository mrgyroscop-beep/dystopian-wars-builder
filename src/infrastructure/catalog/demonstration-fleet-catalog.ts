import type { StoredRoster } from "../../application/rosters/create-roster";
import type { RosterCatalogGateway } from "../../application/rosters/workspace";
import {
  DOMAIN_SCHEMA_VERSION,
  type CostAmount,
  type DomainCatalog,
  type DomainEntity,
  type EntityId,
  type EntityKind,
  type Placement,
  type PlacementId,
  type SourceNodeId,
} from "../../domain/catalog";

const source = {
  repository: "local/demonstration-fixtures",
  commit: "0".repeat(40),
  tree: "0".repeat(40),
  commitTimestamp: "2026-08-02T00:00:00.000Z",
} as const;

const categoryNames = [
  "Flagship",
  "Line",
  "Patrol",
  "Support",
  "Scout",
  "Logistical",
  "Auxiliary",
] as const;

const pointsTypeId = entityId("demo-cost-type-points");
const victoryPointsTypeId = entityId("demo-cost-type-vp");

export function createDemonstrationFleetCatalog(): DomainCatalog {
  const battlefleetId = entityId("demo-empire-patrol");
  const flagshipElementId = entityId("demo-flagship");
  const lineElementId = entityId("demo-line");
  const categories = categoryNames.map((name) =>
    entity("Category", entityId(`demo-category-${name.toLocaleLowerCase("en")}`), name),
  );
  const entities: DomainEntity[] = [
    entity("Battlefleet", battlefleetId, "Harbour Patrol"),
    entity("BattlefleetElement", flagshipElementId, "Flagship Element"),
    entity("BattlefleetElement", lineElementId, "Line Element"),
    entity("CostType", pointsTypeId, "Points"),
    entity("CostType", victoryPointsTypeId, "VP"),
    ...categories,
  ];
  const placements: Placement[] = [
    placement("demo-placement-flagship-element", battlefleetId, flagshipElementId, 0),
    placement("demo-placement-line-element", battlefleetId, lineElementId, 1),
  ];

  for (let index = 1; index <= 112; index += 1) {
    const categoryIndex = (index - 1) % categoryNames.length;
    const category = categoryNames[categoryIndex]!;
    const categoryId = categories[categoryIndex]!.id;
    const unitId = entityId(`demo-ship-${String(index).padStart(3, "0")}`);
    const pointsId = entityId(`demo-points-${String(index).padStart(3, "0")}`);
    const victoryPointsId = entityId(`demo-vp-${String(index).padStart(3, "0")}`);
    const availability =
      index % 31 === 0 ? "indeterminate" : index % 29 === 0 ? "unavailable" : null;
    const attributes: Record<string, string> = {
      category,
      role: category === "Auxiliary" ? "Specialist" : `${category} vessel`,
      nation: "Demonstration Fleet",
      platform: index % 5 === 0 ? "Aerial" : index % 7 === 0 ? "Submersible" : "Surface",
    };
    if (availability) {
      attributes["demo.availability"] = availability;
      attributes["demo.availabilityReason"] =
        availability === "indeterminate"
          ? "Учебная запись содержит неполное правило доступности; добавление заблокировано."
          : "Этот учебный корпус не входит в выбранный Harbour Patrol.";
    }
    const points = 35 + (index % 9) * 10;
    const victoryPoints = index % 4;
    const name =
      index === 1
        ? "Asterion Demonstrator"
        : `${category === "Auxiliary" ? "Harbour" : category} Pattern ${String(index).padStart(3, "0")}`;
    entities.push(
      entity("Unit", unitId, name, {
        description: presentation(
          `Учебный ${category.toLocaleLowerCase("ru")} корпус. Данные придуманы для проверки интерфейса и не являются игровым каталогом.`,
        ),
        attributes,
        categoryIds: [categoryId],
        costIds: [pointsId, victoryPointsId],
      }),
      cost(pointsId, "Points", String(points), "points", pointsTypeId),
      cost(victoryPointsId, "VP", String(victoryPoints), "victory-points", victoryPointsTypeId),
    );
    if (availability === "unavailable") continue;
    const targets =
      index % 17 === 0
        ? [flagshipElementId, lineElementId]
        : category === "Flagship"
          ? [flagshipElementId]
          : [lineElementId];
    for (const [targetIndex, ownerId] of targets.entries())
      placements.push(
        placement(
          `demo-placement-${index}-${targetIndex}`,
          ownerId,
          unitId,
          index * 2 + targetIndex,
        ),
      );
  }

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    contentVersion: "demonstration-1",
    source,
    entities: Object.fromEntries(entities.map((candidate) => [candidate.id, candidate])),
    placements: Object.fromEntries(placements.map((candidate) => [candidate.id, candidate])),
    slots: {},
    aliases: {},
    roots: [battlefleetId],
    diagnostics: [],
  };
}

export function createDemonstrationFleetCatalogGateway(): RosterCatalogGateway {
  const catalog = createDemonstrationFleetCatalog();
  return {
    contractVersion: 1,
    load(contentVersion) {
      if (contentVersion !== catalog.contentVersion)
        return Promise.reject(new Error("Demonstration catalog version is unavailable"));
      return Promise.resolve(catalog);
    },
  };
}

export function createDemonstrationWorkspaceRoster(id = "scaffold-demo"): StoredRoster {
  return {
    contractVersion: 1,
    id,
    name: "Учебная эскадра",
    faction: { id: "demo-empire", label: "Empire" },
    battlefleet: { id: "demo-empire-patrol", label: "Harbour Patrol" },
    limits: { points: 1_000, victoryPoints: 10 },
    requiredElements: [
      { id: "demo-flagship", label: "Flagship Element", minimum: 1 },
      { id: "demo-line", label: "Line Element", minimum: 1 },
    ],
    roster: {
      contractVersion: 1,
      id,
      catalogContentVersion: "demonstration-1",
      rootInstanceIds: [],
      instances: {},
    },
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z",
  };
}

function entity(
  kind: EntityKind,
  id: EntityId,
  label: string,
  overrides: Partial<DomainEntity> = {},
): DomainEntity {
  return {
    contractVersion: 1,
    id,
    kind,
    sourceTag: "demonstration",
    identityQuality: "synthetic",
    identity: {
      contractVersion: 1,
      canonicalId: id,
      sourceNodeId: sourceNodeId(id),
      upstreamId: null,
      occurrence: 1,
      quality: "synthetic",
      migrationAliasIds: [],
    },
    label: presentation(label),
    labels: {
      contractVersion: 1,
      canonicalLabel: label,
      sourceLabel: null,
      aliases: [],
      locale: "und",
      fallbackLabel: label,
    },
    attributes: {},
    fields: [],
    extensions: [],
    categoryIds: [],
    costIds: [],
    constraintIds: [],
    conditionIds: [],
    modifierIds: [],
    repeatIds: [],
    profileIds: [],
    ruleIds: [],
    slotIds: [],
    provenance: provenance(id),
    ...overrides,
  } as DomainEntity;
}

function cost(
  id: EntityId,
  label: string,
  raw: string,
  resource: "points" | "victory-points",
  costTypeId: EntityId,
): Extract<DomainEntity, { kind: "Cost" }> {
  const amount: CostAmount =
    raw === "0"
      ? { contractVersion: 1, state: "zero", value: "0" }
      : { contractVersion: 1, state: "value", value: raw };
  return entity("Cost", id, label, {
    amount,
    semantics: {
      contractVersion: 1,
      amount,
      costTypeId,
      sourceCostTypeId: resource === "points" ? "points" : "vp",
      resource,
      role: "base",
      scope: null,
    },
  }) as Extract<DomainEntity, { kind: "Cost" }>;
}

function placement(
  value: string,
  ownerId: EntityId,
  definitionId: EntityId,
  order: number,
): Placement {
  return {
    contractVersion: 1,
    id: value as PlacementId,
    ownerId,
    definitionId,
    slotId: null,
    order,
    linkKind: "ownership",
    resolved: true,
    ambiguous: false,
    targetSourceNodeId: sourceNodeId(definitionId),
    resolution: null,
    overlay: {
      categoryIds: [],
      costIds: [],
      constraintIds: [],
      conditionIds: [],
      modifierIds: [],
      repeatIds: [],
      attributes: {},
    },
    provenance: provenance(ownerId),
  };
}

function presentation(value: string) {
  return {
    plainText: value,
    blocks: value
      ? [{ type: "paragraph" as const, children: [{ type: "text" as const, value }] }]
      : [],
    contentUnavailable: false,
    diagnostics: [],
  } as const;
}

function provenance(id: EntityId) {
  return {
    source,
    documentPath: "demonstration-fixture.json",
    documentBlob: "0".repeat(40),
    documentSha256: "0".repeat(64),
    documentRootId: "demonstration",
    sourceNodeId: sourceNodeId(id),
    sourceTag: "demonstration",
    upstreamId: null,
    occurrence: 1,
    xmlPath: "/demonstration",
    resolutionChain: [],
    sourceRevision: "1",
    importRevision: 1,
    schemaRevision: DOMAIN_SCHEMA_VERSION,
  } as const;
}

function entityId(value: string): EntityId {
  return value as EntityId;
}

function sourceNodeId(value: string): SourceNodeId {
  return `demo-source:${value}` as SourceNodeId;
}
