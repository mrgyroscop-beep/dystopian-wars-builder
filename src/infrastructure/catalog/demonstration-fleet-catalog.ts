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
  const empireBattlefleetId = entityId("demo-empire-patrol");
  const flagshipElementId = entityId("demo-flagship");
  const lineElementId = entityId("demo-line");
  const crownBattlefleetId = entityId("demo-crown-vanguard");
  const commandElementId = entityId("demo-command");
  const patrolElementId = entityId("demo-patrol");
  const categories = categoryNames.map((name) =>
    entity("Category", entityId(`demo-category-${name.toLocaleLowerCase("en")}`), name),
  );
  const entities: DomainEntity[] = [
    entity("Battlefleet", empireBattlefleetId, "Harbour Patrol"),
    entity("BattlefleetElement", flagshipElementId, "Flagship Element"),
    entity("BattlefleetElement", lineElementId, "Line Element"),
    entity("Battlefleet", crownBattlefleetId, "Vanguard Exercise"),
    entity("BattlefleetElement", commandElementId, "Command Element"),
    entity("BattlefleetElement", patrolElementId, "Patrol Element"),
    entity("CostType", pointsTypeId, "Points"),
    entity("CostType", victoryPointsTypeId, "VP"),
    ...categories,
  ];
  const placements: Placement[] = [
    placement("demo-placement-flagship-element", empireBattlefleetId, flagshipElementId, 0),
    placement("demo-placement-line-element", empireBattlefleetId, lineElementId, 1),
    placement("demo-placement-command-element", crownBattlefleetId, commandElementId, 0),
    placement("demo-placement-patrol-element", crownBattlefleetId, patrolElementId, 1),
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
    if (index === 1) attributes["demo.editor"] = "akita";
    if (availability) {
      attributes["demo.availability"] = availability;
      attributes["demo.availabilityReason"] =
        availability === "indeterminate"
          ? "Учебная запись содержит неполное правило доступности; добавление заблокировано."
          : "Этот учебный корпус недоступен для выбранного Battlefleet.";
    }
    const points = index === 1 ? 350 : 35 + (index % 9) * 10;
    const victoryPoints = index === 1 ? 9 : index % 4;
    const name =
      index === 1
        ? "Akita Demonstrator"
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
    const empireTargets =
      index % 17 === 0
        ? [flagshipElementId, lineElementId]
        : category === "Flagship"
          ? [flagshipElementId]
          : [lineElementId];
    const crownTargets =
      index % 17 === 0
        ? [commandElementId, patrolElementId]
        : category === "Flagship"
          ? [commandElementId]
          : [patrolElementId];
    const targets = [...empireTargets, ...crownTargets];
    for (const [targetIndex, ownerId] of targets.entries())
      placements.push(
        placement(
          `demo-placement-${index}-${targetIndex}`,
          ownerId,
          unitId,
          index * 4 + targetIndex,
        ),
      );
  }

  const editorEntities = [
    ["Model", "demo-akita-model", "Akita structural Model", 0],
    ["Weapon", "demo-akita-magma-cast", "Magma Cast", 0],
    ["Weapon", "demo-akita-heavy-battery", "Heavy Battery", 15],
    ["Weapon", "demo-akita-sealed-array", "Sealed Experimental Array", 25],
    ["Generator", "demo-akita-kagutsuchi", "Kagutsuchi Generator", 20],
    ["Generator", "demo-akita-fury-generator", "Fury Generator", 0],
    ["Weapon", "demo-akita-rocket-battery", "Rocket Battery", 10],
    ["Weapon", "demo-akita-flak-battery", "Flak Battery", 0],
    ["Generator", "demo-akita-shield-generator", "Shield Generator", 10],
    ["Weapon", "demo-akita-mine-layer", "Mine Layer", 0],
    ["Attachment", "demo-akita-repair-crane", "Repair Crane", 5],
    ["Escort", "demo-akita-tanuki-escort", "Tanuki Escort", 10],
    ["Option", "demo-akita-escort-discount", "Escort formation discount", -10],
  ] as const satisfies readonly (readonly [EntityKind, string, string, number])[];
  for (const [kind, rawId, label, points] of editorEntities) {
    const id = entityId(rawId);
    const pointCostId = entityId(`${rawId}-points`);
    entities.push(
      entity(kind, id, label, {
        attributes: {
          "demo.editor": "akita",
          "demo.catalog": "hidden",
          ...(rawId === "demo-akita-escort-discount" ? { "demo.hidden": "true" } : {}),
        },
        costIds: points === 0 ? [] : [pointCostId],
      }),
    );
    if (points !== 0)
      entities.push(cost(pointCostId, "Points", String(points), "points", pointsTypeId));
  }

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    contentVersion: "demonstration-1",
    source,
    entities: Object.fromEntries(entities.map((candidate) => [candidate.id, candidate])),
    placements: Object.fromEntries(placements.map((candidate) => [candidate.id, candidate])),
    slots: {},
    aliases: {},
    roots: [empireBattlefleetId, crownBattlefleetId],
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
