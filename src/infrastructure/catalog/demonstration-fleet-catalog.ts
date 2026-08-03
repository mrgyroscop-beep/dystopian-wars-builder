import type { StoredRoster } from "../../application/rosters/create-roster";
import type { RosterCatalogGateway } from "../../application/rosters/workspace";
import {
  DOMAIN_SCHEMA_VERSION,
  type CostAmount,
  type DomainCatalog,
  type DomainEntity,
  type EntityId,
  type EntityKind,
  type EvaluatorExpression,
  type Placement,
  type PlacementId,
  type Slot,
  type SlotId,
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
  const empireLineBattlefleetId = entityId("demo-empire-line-squadron");
  const flagshipElementId = entityId("demo-flagship");
  const lineElementId = entityId("demo-line");
  const crownBattlefleetId = entityId("demo-crown-vanguard");
  const commandElementId = entityId("demo-command");
  const patrolElementId = entityId("demo-patrol");
  const akitaDiscountModifierId = entityId("demo-akita-escort-discount-modifier");
  const akitaRequirementModifierId = entityId("demo-akita-kagutsuchi-requirement");
  const categories = categoryNames.map((name) =>
    entity("Category", entityId(`demo-category-${name.toLocaleLowerCase("en")}`), name),
  );
  const entities: DomainEntity[] = [
    entity("Battlefleet", empireBattlefleetId, "Harbour Patrol"),
    entity("Battlefleet", empireLineBattlefleetId, "Line Squadron"),
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
    placement("demo-placement-line-squadron-element", empireLineBattlefleetId, lineElementId, 0),
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
        modifierIds: index === 1 ? [akitaDiscountModifierId, akitaRequirementModifierId] : [],
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

  const modelId = entityId("demo-akita-model");
  const modelProfileId = entityId("demo-akita-profile");
  const baseWeaponId = entityId("demo-akita-fore-battery-profile");
  const torrentRuleId = entityId("synthetic-rule-torrent");
  const submergedRuleId = entityId("synthetic-rule-submerged");
  const psaSlotId = slotId("demo-akita-slot-psa");
  const fps1SlotId = slotId("demo-akita-slot-fps-1");
  const fps2SlotId = slotId("demo-akita-slot-fps-2");
  const fps3SlotId = slotId("demo-akita-slot-fps-3");
  const attachmentSlotId = slotId("demo-akita-slot-attachments");
  const escortSlotId = slotId("demo-akita-slot-escorts");
  const empireDoctrineSlotId = slotId("demo-empire-slot-doctrine");
  const crownDoctrineSlotId = slotId("demo-crown-slot-doctrine");
  const magmaId = entityId("demo-akita-magma-cast");
  const kagutsuchiId = entityId("demo-doctrine-kagutsuchi");
  const escortId = entityId("demo-akita-tanuki-escort");
  const sealedAvailabilityId = entityId("demo-akita-sealed-availability");
  const hasKagutsuchiId = entityId("demo-akita-has-kagutsuchi");
  const lacksMagmaId = entityId("demo-akita-lacks-magma");
  const kagutsuchiGroupId = entityId("demo-akita-kagutsuchi-and-no-magma");
  const escortDiscountConditionId = entityId("demo-akita-four-escorts");

  const editorEntities = [
    ["Generator", "demo-akita-magma-cast", "Magma Cast Generator", 0],
    ["Weapon", "demo-akita-heavy-battery", "Heavy Battery", 15],
    ["Weapon", "demo-akita-sealed-array", "Sealed Experimental Array", 25],
    ["Generator", "demo-akita-fury-generator", "Fury Generator", 0],
    ["Weapon", "demo-akita-torpedo-battery", "Torpedo Battery", 5],
    ["Weapon", "demo-akita-rocket-battery", "Rocket Battery", 10],
    ["Weapon", "demo-akita-flak-battery", "Flak Battery", 0],
    ["Generator", "demo-akita-shield-generator", "Shield Generator", 10],
    ["Weapon", "demo-akita-mine-layer", "Mine Layer", 0],
    ["Attachment", "demo-akita-repair-crane", "Repair Crane", 5],
    ["Escort", "demo-akita-tanuki-escort", "Tanuki Escort", 10],
    ["Doctrine", "demo-doctrine-kagutsuchi", "Kagutsuchi Doctrine", 0],
  ] as const satisfies readonly (readonly [EntityKind, string, string, number])[];
  for (const [kind, rawId, label, points] of editorEntities) {
    const id = entityId(rawId);
    const pointCostId = entityId(`${rawId}-points`);
    entities.push(
      entity(kind, id, label, {
        attributes: {
          "demo.editor": "akita",
          "demo.catalog": "hidden",
        },
        costIds: points === 0 ? [] : [pointCostId],
        fields: kind === "Weapon" ? weaponFields(id, label) : [],
        ruleIds:
          kind === "Weapon"
            ? [torrentRuleId, ...(label.includes("Torpedo") ? [submergedRuleId] : [])]
            : [],
      }),
    );
    if (points !== 0)
      entities.push(cost(pointCostId, "Points", String(points), "points", pointsTypeId, "delta"));
  }

  entities.push(
    entity("Model", modelId, "Akita", {
      attributes: {
        "demo.editor": "ship",
        "demo.catalog": "hidden",
      },
      slotIds: [psaSlotId, fps1SlotId, fps2SlotId, fps3SlotId, attachmentSlotId, escortSlotId],
      profileIds: [modelProfileId, baseWeaponId],
      ruleIds: [torrentRuleId, submergedRuleId],
    }),
    entity("Profile", modelProfileId, "Akita Model", {
      fields: profileFields(modelProfileId, [
        ["Hull", "8"],
        ["Armour", "5"],
        ["Speed", '7"'],
      ]),
    }),
    entity("Weapon", baseWeaponId, "Fore Battery", {
      fields: weaponFields(baseWeaponId, "Fore Battery"),
      ruleIds: [torrentRuleId],
    }),
    entity("Rule", torrentRuleId, "Torrent", {
      description: presentation("Атака Torrent игнорирует штраф за стрельбу через препятствия."),
    }),
    entity("Rule", submergedRuleId, "Submerged", {
      description: presentation(
        "Submerged-модель использует специальные правила глубины и обнаружения.",
      ),
    }),
    expressionEntity("Condition", sealedAvailabilityId, {
      operator: "instanceOf",
      field: "selections",
      scope: "unit",
      value: "1",
      references: [entityId("demo-never-selected")],
    }),
    entity("Option", entityId("demo-never-selected"), "Unavailable sentinel", {
      attributes: { "demo.catalog": "hidden" },
    }),
    expressionEntity("Condition", hasKagutsuchiId, {
      operator: "instanceOf",
      field: "selections",
      scope: "force",
      value: "1",
      references: [kagutsuchiId],
    }),
    expressionEntity("Condition", lacksMagmaId, {
      operator: "notInstanceOf",
      field: "selections",
      scope: "unit",
      value: "1",
      references: [magmaId],
    }),
    expressionEntity("ConditionGroup", kagutsuchiGroupId, {
      operator: "and",
      conditionIds: [hasKagutsuchiId, lacksMagmaId],
    }),
    expressionEntity("Modifier", akitaRequirementModifierId, {
      operator: "append",
      field: "error",
      scope: "unit",
      value: "Kagutsuchi Doctrine requires Magma Cast Generator.",
      conditionIds: [kagutsuchiGroupId],
      flags: { targetSlotId: psaSlotId },
    }),
    expressionEntity("Condition", escortDiscountConditionId, {
      operator: "atLeast",
      field: "selections",
      scope: "unit",
      value: "4",
      references: [escortId],
    }),
    expressionEntity("Modifier", akitaDiscountModifierId, {
      operator: "decrement",
      field: pointsTypeId,
      scope: "unit",
      value: "10",
      conditionIds: [escortDiscountConditionId],
    }),
  );

  const slotDefinitions = [
    [
      psaSlotId,
      "Hardpoint",
      "PSA",
      1,
      1,
      ["demo-akita-magma-cast", "demo-akita-heavy-battery", "demo-akita-sealed-array"],
    ],
    [
      fps1SlotId,
      "Hardpoint",
      "FPS 1",
      1,
      1,
      ["demo-akita-fury-generator", "demo-akita-torpedo-battery"],
    ],
    [
      fps2SlotId,
      "Hardpoint",
      "FPS 2",
      1,
      1,
      ["demo-akita-rocket-battery", "demo-akita-flak-battery"],
    ],
    [
      fps3SlotId,
      "Hardpoint",
      "FPS 3",
      1,
      1,
      ["demo-akita-shield-generator", "demo-akita-mine-layer"],
    ],
    [attachmentSlotId, "Attachment", "Attachments", 0, 1, ["demo-akita-repair-crane"]],
    [escortSlotId, "Escort", "Escorts", 0, 4, ["demo-akita-tanuki-escort"]],
  ] as const;
  const slots: Slot[] = [];
  const profileRoles = new Map<SlotId, NonNullable<Slot["semantics"]["profileRole"]>>([
    [psaSlotId, "psa"],
    [fps1SlotId, "fps-1"],
    [fps2SlotId, "fps-2"],
    [fps3SlotId, "fps-3"],
  ]);
  placements.push(
    placement("demo-akita-model-placement", entityId("demo-ship-001"), modelId, 0, null, {
      cardinality: selectionCardinality(1, 1),
    }),
  );
  for (const [id, kind, label, minimum, maximum, optionIds] of slotDefinitions) {
    const optionPlacements = optionIds.map((rawId, index) => {
      const overlay =
        rawId === "demo-akita-sealed-array"
          ? {
              conditionIds: [sealedAvailabilityId],
              attributes: {
                "editor.unavailableReason": "Недоступно для учебной доктрины Harbour Patrol.",
              },
            }
          : {};
      const candidate = placement(
        `demo-placement-${id}-${index}`,
        modelId,
        entityId(rawId),
        index,
        id,
        overlay,
      );
      placements.push(candidate);
      return candidate.id;
    });
    const constraintIds = addCardinalityConstraints(entities, id, minimum, maximum);
    const slot = editorSlot(
      id,
      modelId,
      kind,
      label,
      minimum,
      maximum,
      optionPlacements,
      constraintIds,
    );
    slots.push({
      ...slot,
      semantics: { ...slot.semantics, profileRole: profileRoles.get(id) ?? null },
    });
  }
  for (const [id, ownerId] of [
    [empireDoctrineSlotId, empireBattlefleetId],
    [crownDoctrineSlotId, crownBattlefleetId],
  ] as const) {
    const option = placement(`demo-placement-${id}-kagutsuchi`, ownerId, kagutsuchiId, 0, id);
    placements.push(option);
    slots.push(
      editorSlot(
        id,
        ownerId,
        "Doctrine",
        "Доктрина флота",
        0,
        1,
        [option.id],
        addCardinalityConstraints(entities, id, 0, 1),
      ),
    );
  }
  const battlefleetSlotIds = new Map<EntityId, SlotId[]>([
    [empireBattlefleetId, [empireDoctrineSlotId]],
    [crownBattlefleetId, [crownDoctrineSlotId]],
  ]);
  for (const [index, candidate] of entities.entries()) {
    const ids = battlefleetSlotIds.get(candidate.id);
    if (ids) entities[index] = { ...candidate, slotIds: ids };
  }

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    contentVersion: "demonstration-1",
    source,
    entities: Object.fromEntries(entities.map((candidate) => [candidate.id, candidate])),
    placements: Object.fromEntries(placements.map((candidate) => [candidate.id, candidate])),
    slots: Object.fromEntries(slots.map((candidate) => [candidate.id, candidate])),
    aliases: {},
    roots: [empireBattlefleetId, empireLineBattlefleetId, crownBattlefleetId],
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
  role: "base" | "delta" = "base",
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
      role,
      scope: null,
    },
  }) as Extract<DomainEntity, { kind: "Cost" }>;
}

function placement(
  value: string,
  ownerId: EntityId,
  definitionId: EntityId,
  order: number,
  slotIdValue: SlotId | null = null,
  overlay: Partial<Placement["overlay"]> = {},
): Placement {
  return {
    contractVersion: 1,
    id: value as PlacementId,
    ownerId,
    definitionId,
    slotId: slotIdValue,
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
      ...overlay,
    },
    provenance: provenance(ownerId),
  };
}

function expressionEntity(
  kind: "Condition" | "ConditionGroup" | "Constraint" | "Modifier",
  id: EntityId,
  options: Partial<EvaluatorExpression> & {
    readonly conditionIds?: readonly EntityId[];
  },
): Extract<DomainEntity, { expression: EvaluatorExpression }> {
  const { conditionIds = [], ...expression } = options;
  return entity(kind, id, id, {
    conditionIds,
    expression: {
      contractVersion: 1,
      operator: null,
      field: null,
      scope: null,
      value: null,
      references: [],
      referenceResolutions: [],
      flags: {},
      evaluable: true,
      unevaluableReasons: [],
      ...expression,
    },
  }) as Extract<DomainEntity, { expression: EvaluatorExpression }>;
}

function editorSlot(
  id: SlotId,
  ownerId: EntityId,
  kind: Slot["kind"],
  label: string,
  minimum: number,
  maximum: number,
  placementIds: readonly PlacementId[],
  constraintIds: readonly EntityId[],
): Slot {
  return {
    contractVersion: 1,
    id,
    ownerId,
    kind,
    label: presentation(label),
    placementIds,
    optionPlacementIds: placementIds,
    cardinality: selectionCardinality(minimum, maximum),
    costIds: [],
    constraintIds,
    conditionIds: [],
    modifierIds: [],
    hidden: false,
    helper: false,
    semantics: { contractVersion: 1, selection: "option", evaluation: "deferred-to-kan-32" },
    provenance: provenance(ownerId),
  };
}

function weaponFields(ownerId: EntityId, label: string): DomainEntity["fields"] {
  const seed = [...label].reduce((sum, character) => sum + character.codePointAt(0)!, 0);
  return profileFields(ownerId, [
    ["Weapon", label],
    ["Arc", seed % 2 === 0 ? "Fore" : "Port / Starboard"],
    ["Close", String(8 + (seed % 4))],
    ["Standard", String(5 + (seed % 4))],
    ["Extreme", String(2 + (seed % 3))],
    ["Qualities", label.includes("Torpedo") ? "Torrent, Submerged" : "Torrent"],
  ]);
}

function profileFields(
  ownerId: EntityId,
  values: readonly (readonly [string, string])[],
): DomainEntity["fields"] {
  return values.map(([label, value], order) => ({
    contractVersion: 1,
    sourceTag: "demonstration-field",
    order,
    label: presentation(label),
    value: presentation(value),
    attributes: {},
    provenance: provenance(ownerId),
  }));
}

function selectionCardinality(minimum: number, maximum: number): Slot["cardinality"] {
  return {
    contractVersion: 1,
    minimum:
      minimum === 0
        ? { contractVersion: 1, state: "zero", value: "0" }
        : { contractVersion: 1, state: "value", value: String(minimum) },
    maximum:
      maximum === 0
        ? { contractVersion: 1, state: "zero", value: "0" }
        : { contractVersion: 1, state: "value", value: String(maximum) },
    effective: "deferred-to-kan-32",
  };
}

function addCardinalityConstraints(
  entities: DomainEntity[],
  id: SlotId,
  minimum: number,
  maximum: number,
): EntityId[] {
  const minimumId = entityId(`${id}-minimum`);
  const maximumId = entityId(`${id}-maximum`);
  entities.push(
    expressionEntity("Constraint", minimumId, {
      operator: "min",
      field: "selections",
      scope: "parent",
      value: String(minimum),
    }),
    expressionEntity("Constraint", maximumId, {
      operator: "max",
      field: "selections",
      scope: "parent",
      value: String(maximum),
    }),
  );
  return [minimumId, maximumId];
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

function slotId(value: string): SlotId {
  return value as SlotId;
}
