import {
  entityId,
  parseOccurrence,
  placementId,
  slotId,
  sourceNodeId,
  upstreamIdFromKey,
} from "./identifiers";
import { hardpointWeightFromLabel } from "./hardpoint-weight";
import { presentationFromNode, toSafePresentation } from "./presentation";
import {
  DOMAIN_SCHEMA_VERSION,
  type DomainEntityBase,
  type DomainVocabulary,
  type CatalogNormalizationInput,
  type CostAmount,
  type DomainCatalog,
  type DomainDiagnostic,
  type DomainEntity,
  type EntityId,
  type EntityKind,
  type EvaluatorExpression,
  type LosslessDocument,
  type LosslessExtension,
  type LosslessNode,
  type MigrationAlias,
  type NormalizationOptions,
  type Placement,
  type PlacementId,
  type PlacementOverlay,
  type Provenance,
  type ReferenceResolution,
  type Slot,
  type SlotId,
  type SourceNodeId,
} from "./types";
import { PINNED_DW4_VOCABULARY } from "./vocabulary";

const structuralContainers = new Set([
  "attributeTypes",
  "attributes",
  "catalogueLinks",
  "categoryEntries",
  "categoryLinks",
  "characteristicTypes",
  "characteristics",
  "conditionGroups",
  "conditions",
  "constraints",
  "costTypes",
  "costs",
  "entryLinks",
  "forceEntries",
  "infoLinks",
  "modifiers",
  "profileTypes",
  "profiles",
  "publications",
  "repeats",
  "rules",
  "selectionEntries",
  "selectionEntryGroups",
  "sharedProfiles",
  "sharedRules",
  "sharedSelectionEntries",
  "sharedSelectionEntryGroups",
]);
const linkTags = new Set(["catalogueLink", "categoryLink", "entryLink", "infoLink"]);
const fieldTags = new Set(["attribute", "characteristic"]);
const expressionKinds = new Set<EntityKind>([
  "Constraint",
  "Condition",
  "ConditionGroup",
  "Modifier",
  "Repeat",
]);
const slotKinds = new Set<EntityKind>([
  "OptionSlot",
  "Hardpoint",
  "Generator",
  "Attachment",
  "Escort",
  "Doctrine",
]);
const knownConditionOperators = new Set([
  "atLeast",
  "atMost",
  "equalTo",
  "notEqualTo",
  "instanceOf",
  "lessThan",
  "notInstanceOf",
]);
const knownModifierOperators = new Set([
  "add",
  "append",
  "decrement",
  "increment",
  "multiply",
  "set",
  "set-primary",
]);
const knownConditionGroupOperators = new Set(["and", "or"]);
const knownFields = new Set([
  "forces",
  "selections",
  "limit::category",
  "limit::selection",
  "cost",
  "name",
  "error",
  "hidden",
  "category",
]);
const knownScopes = new Set([
  "ancestor",
  "force",
  "parent",
  "root-entry",
  "roster",
  "self",
  "unit",
]);

interface NodeContext {
  readonly document: LosslessDocument;
  readonly rootId: string;
  readonly node: LosslessNode;
  readonly id: SourceNodeId;
  readonly entityId: EntityId | null;
  readonly kind: EntityKind | null;
  readonly ancestorTags: readonly string[];
}

interface MutableEntity extends Omit<
  DomainEntityBase<EntityKind>,
  | "categoryIds"
  | "costIds"
  | "constraintIds"
  | "conditionIds"
  | "modifierIds"
  | "repeatIds"
  | "profileIds"
  | "ruleIds"
  | "slotIds"
> {
  categoryIds: EntityId[];
  costIds: EntityId[];
  constraintIds: EntityId[];
  conditionIds: EntityId[];
  modifierIds: EntityId[];
  repeatIds: EntityId[];
  profileIds: EntityId[];
  ruleIds: EntityId[];
  slotIds: SlotId[];
  amount?: CostAmount;
  expression?: EvaluatorExpression;
}

interface MutableSlot extends Omit<Slot, "placementIds"> {
  placementIds: Placement["id"][];
}

export class DomainNormalizationError extends Error {
  constructor(readonly diagnostics: readonly DomainDiagnostic[]) {
    super(
      diagnostics.some((diagnostic) => diagnostic.code.includes("IDENTITY_COLLISION"))
        ? "Domain catalog normalization failed: identity collision"
        : diagnostics.some((diagnostic) => diagnostic.code.includes("REFERENCE"))
          ? "Domain catalog normalization failed: reference resolution"
          : "Domain catalog normalization failed",
    );
    this.name = "DomainNormalizationError";
  }
}

export function normalizeCatalog(
  input: CatalogNormalizationInput,
  options: NormalizationOptions = {},
): DomainCatalog {
  validateInput(input);
  options.observeMemoryCheckpoint?.();
  const diagnostics: DomainDiagnostic[] = [];
  const vocabulary = options.vocabulary ?? PINNED_DW4_VOCABULARY;
  const referencePolicy = options.referencePolicy ?? "fatal";
  const entities = new Map<string, MutableEntity>();
  const placements = new Map<string, Placement>();
  const slots = new Map<string, MutableSlot>();
  const aliases = new Map<string, MigrationAlias>();
  const contexts = new Map<string, NodeContext>();
  const upstreamIndex = new Map<string, NodeContext[]>();
  const identityIndex = new Map<string, string>();
  const rootEntityIds: EntityId[] = [];

  for (const document of input.graph.documents) {
    const rootUpstreamId = document.root.attributes.id ?? upstreamIdFromKey(document.root.key);
    collectContexts(document.root, document, rootUpstreamId, null, []);
    options.observeMemoryCheckpoint?.();
  }

  let normalizedEntities = 0;
  for (const context of contexts.values()) {
    if (!context.kind || !context.entityId) continue;
    const node = context.node;
    const identityQualityValue = identityQuality(node);
    const label = toSafePresentation(node.attributes.name ?? node.text ?? context.kind);
    const occurrence = parseOccurrence(node.key);
    const entity: MutableEntity = {
      contractVersion: 1,
      id: context.entityId,
      kind: context.kind,
      sourceTag: node.tag,
      identityQuality: identityQualityValue,
      identity: {
        contractVersion: 1,
        canonicalId: context.entityId,
        sourceNodeId: context.id,
        upstreamId: node.attributes.id ?? null,
        occurrence,
        quality: identityQualityValue,
        migrationAliasIds: [],
      },
      label,
      labels: labelsOf(node, context.kind, label.plainText),
      ...descriptionOf(node),
      attributes: safeAttributes(node.attributes),
      fields: fieldsOf(context, contexts, input),
      extensions: extensionsOf(context, contexts, input),
      categoryIds: [],
      costIds: [],
      constraintIds: [],
      conditionIds: [],
      modifierIds: [],
      repeatIds: [],
      profileIds: [],
      ruleIds: [],
      slotIds: [],
      ...(context.kind === "Cost"
        ? {
            amount: parseCostAmount(node.attributes.value),
            semantics: costSemantics(context, upstreamIndex),
          }
        : {}),
      ...(expressionKinds.has(context.kind)
        ? { expression: expressionOf(context, upstreamIndex, diagnostics) }
        : {}),
      provenance: provenanceOf(context, input),
    };
    entities.set(entity.id, entity);
    if (context.node === context.document.root) rootEntityIds.push(entity.id);
    if (entity.identityQuality !== "upstream") {
      diagnostics.push({
        code: entity.identityQuality === "scoped" ? "DUPLICATE_UPSTREAM_ID" : "SYNTHETIC_IDENTITY",
        severity: "warning",
        sourceNodeId: context.id,
        detail: { identityQuality: entity.identityQuality, entityId: entity.id },
      });
    }
    if (isSlotKind(context.kind)) {
      const id = slotId(entity.id);
      entity.slotIds.push(id);
      slots.set(id, {
        contractVersion: 1,
        id,
        ownerId: entity.id,
        kind: context.kind,
        label: entity.label,
        placementIds: [],
        optionPlacementIds: [],
        cardinality: slotCardinality(node),
        costIds: [],
        constraintIds: [],
        conditionIds: [],
        modifierIds: [],
        hidden: node.attributes.hidden === "true",
        helper: node.attributes.helper === "true",
        semantics: {
          contractVersion: 1,
          selection: "option",
          evaluation: "deferred-to-kan-32",
          profileRole: node.attributes.id
            ? (vocabulary.profileSlotRoles?.[node.attributes.id] ?? null)
            : null,
          hardpointWeight:
            context.kind === "Hardpoint" ? hardpointWeightFromLabel(entity.label.plainText) : null,
        },
        provenance: entity.provenance,
      });
    }
    normalizedEntities += 1;
    if (normalizedEntities % 512 === 0) options.observeMemoryCheckpoint?.();
  }

  for (const document of input.graph.documents) {
    const root = contexts.get(document.root.key);
    if (root) connect(root, null, null, 0);
    options.observeMemoryCheckpoint?.();
  }

  attachTargetedModifiers();

  for (const alias of aliases.values()) {
    for (const target of alias.entityIds) {
      const entity = entities.get(target);
      if (!entity) continue;
      entities.set(target, {
        ...entity,
        identity: {
          ...entity.identity,
          migrationAliasIds: [...entity.identity.migrationAliasIds, alias.alias].sort(),
        },
      });
    }
  }

  const fatal = diagnostics.filter((diagnostic) => diagnostic.severity === "fatal");
  if (fatal.length > 0) throw new DomainNormalizationError(fatal);
  options.observeMemoryCheckpoint?.();

  for (const [id, slot] of slots) {
    const owner = entities.get(slot.ownerId);
    const optionPlacementIds = collectSlotOptions(slot, new Set());
    slots.set(id, {
      ...slot,
      placementIds: optionPlacementIds,
      optionPlacementIds,
      costIds: [...(owner?.costIds ?? [])],
      constraintIds: [...(owner?.constraintIds ?? [])],
      conditionIds: [...(owner?.conditionIds ?? [])],
      modifierIds: [...(owner?.modifierIds ?? [])],
    });
  }

  function collectSlotOptions(slot: MutableSlot, visited: Set<SlotId>): PlacementId[] {
    if (visited.has(slot.id)) return [];
    const nextVisited = new Set(visited).add(slot.id);
    const options = new Map<EntityId, PlacementId>();
    for (const currentPlacementId of slot.placementIds) {
      const placement = placements.get(currentPlacementId);
      const target = placement?.definitionId ? entities.get(placement.definitionId) : null;
      if (!placement || !target || !placement.resolved || placement.ambiguous) continue;
      const nestedSlots = target.slotIds
        .map((nestedId) => slots.get(nestedId))
        .filter((candidate): candidate is MutableSlot => Boolean(candidate));
      if (nestedSlots.some((candidate) => candidate.placementIds.length > 0)) {
        for (const nested of nestedSlots)
          for (const nestedPlacementId of collectSlotOptions(nested, nextVisited)) {
            const nestedPlacement = placements.get(nestedPlacementId);
            if (!nestedPlacement?.definitionId) continue;
            const target = entities.get(nestedPlacement.definitionId);
            if (!target) continue;
            let order = slot.placementIds.length + options.size;
            let projectedId = placementId(
              slot.ownerId,
              target.provenance.sourceNodeId,
              order,
              "reference",
            );
            while (placements.has(projectedId))
              projectedId = placementId(
                slot.ownerId,
                target.provenance.sourceNodeId,
                ++order,
                "reference",
              );
            placements.set(projectedId, {
              ...nestedPlacement,
              id: projectedId,
              ownerId: slot.ownerId,
              slotId: slot.id,
              order,
              linkKind: "reference",
            });
            options.set(nestedPlacement.definitionId, projectedId);
          }
        continue;
      }
      if (
        placement.linkKind === "ownership" &&
        (target.provenance.sourceTag === "entryLink" ||
          target.provenance.sourceTag === "selectionEntryLink")
      )
        continue;
      if (
        ![
          "Unit",
          "Model",
          "Weapon",
          "Option",
          "Generator",
          "Attachment",
          "Escort",
          "Doctrine",
        ].includes(target.kind)
      )
        continue;
      options.set(target.id, placement.id);
    }
    return [...options.values()];
  }

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    contentVersion: "unversioned",
    source: input.source,
    entities: sortedRecord(entities) as unknown as Record<string, DomainEntity>,
    placements: sortedRecord(placements),
    slots: sortedRecord(slots),
    aliases: sortedRecord(aliases),
    roots: [...rootEntityIds].sort(),
    diagnostics: diagnostics.sort(compareDiagnostics),
  };

  function collectContexts(
    node: LosslessNode,
    document: LosslessDocument,
    rootId: string,
    ownerKind: EntityKind | null,
    ancestorTags: readonly string[],
  ): void {
    const upstreamId = upstreamIdFromKey(node.key, node.attributes.id);
    const id = sourceNodeId(rootId, node.tag, upstreamId, parseOccurrence(node.key));
    const locator = `${document.path}:${node.key}`;
    const existingIdentity = identityIndex.get(id);
    if (existingIdentity) {
      diagnostics.push({
        code: "CANONICAL_IDENTITY_COLLISION",
        severity: "fatal",
        sourceNodeId: id,
        detail: { first: existingIdentity, second: locator },
      });
    } else identityIndex.set(id, locator);
    const existingContext = contexts.get(node.key);
    if (existingContext)
      diagnostics.push({
        code: "SOURCE_NODE_IDENTITY_COLLISION",
        severity: "fatal",
        sourceNodeId: id,
        detail: { first: existingContext.document.path, second: document.path },
      });
    const kind = kindOf(node, ownerKind, vocabulary);
    const context = {
      document,
      rootId,
      node,
      id,
      entityId: kind ? entityId(id) : null,
      kind,
      ancestorTags,
    };
    contexts.set(node.key, context);
    if (node.attributes.id && context.entityId) {
      const matches = upstreamIndex.get(node.attributes.id) ?? [];
      matches.push(context);
      upstreamIndex.set(node.attributes.id, matches);
    }
    for (const child of node.children ?? [])
      collectContexts(child, document, rootId, kind ?? ownerKind, [...ancestorTags, node.tag]);
  }

  function connect(
    context: NodeContext,
    ownerId: EntityId | null,
    ownerSlot: SlotId | null,
    order: number,
  ): void {
    const nextOwner = context.entityId ?? ownerId;
    const nextSlot = context.entityId
      ? (slots.get(slotId(context.entityId))?.id ?? ownerSlot)
      : ownerSlot;

    if (context.entityId && ownerId && context.entityId !== ownerId) {
      const placement = createPlacement(
        context,
        contexts,
        input,
        ownerId,
        ownerSlot,
        order,
        context.entityId,
        "ownership",
        true,
        false,
        null,
        null,
      );
      placements.set(placement.id, placement);
      if (ownerSlot) slots.get(ownerSlot)?.placementIds.push(placement.id);
      attach(entities.get(ownerId), context.kind, context.entityId);
    }

    if (linkTags.has(context.node.tag) && ownerId) {
      const candidates = resolveTarget(context.node, contexts, upstreamIndex);
      const definitionId = candidates.length === 1 ? (candidates[0]?.entityId ?? null) : null;
      const resolution = referenceResolution(context, candidates);
      const placement = createPlacement(
        context,
        contexts,
        input,
        ownerId,
        ownerSlot,
        order,
        definitionId,
        "reference",
        candidates.length === 1 && definitionId !== null,
        candidates.length > 1,
        candidates.length === 1 ? (candidates[0]?.id ?? null) : null,
        resolution,
      );
      placements.set(placement.id, placement);
      if (ownerSlot) slots.get(ownerSlot)?.placementIds.push(placement.id);
      if (definitionId) attach(entities.get(ownerId), candidates[0]?.kind ?? null, definitionId);
      else {
        diagnostics.push({
          code: candidates.length > 1 ? "AMBIGUOUS_REFERENCE" : "UNRESOLVED_REFERENCE",
          severity: referencePolicy === "fatal" ? "fatal" : "warning",
          sourceNodeId: context.id,
          detail: { target: context.node.attributes.targetId ?? "", candidates: candidates.length },
        });
      }
    }

    collectExplicitAlias(context, nextOwner);
    let childOrder = 0;
    for (const child of context.node.children ?? []) {
      const childContext = contexts.get(child.key);
      if (childContext) connect(childContext, nextOwner, nextSlot ?? null, childOrder++);
    }
  }

  function collectExplicitAlias(context: NodeContext, target: EntityId | null): void {
    if (context.node.tag !== "alias" || !target) return;
    const rawAlias =
      context.node.attributes.id ?? context.node.attributes.targetId ?? context.node.text;
    if (!rawAlias) return;
    const alias = entityId(sourceNodeId(context.rootId, "alias", rawAlias));
    const existing = aliases.get(alias);
    if (existing && !existing.entityIds.includes(target)) {
      const entityIds = [...existing.entityIds, target].sort();
      aliases.set(alias, { ...existing, entityIds, ambiguous: true });
      diagnostics.push({
        code: "ALIAS_AMBIGUOUS",
        severity: "warning",
        sourceNodeId: context.id,
        detail: { alias, candidates: entityIds.length },
      });
      return;
    }
    if (!existing)
      aliases.set(alias, {
        contractVersion: 1,
        alias,
        label: toSafePresentation(rawAlias),
        entityIds: [target],
        ambiguous: false,
        provenance: provenanceOf(context, input),
        explicit: true,
      });
  }

  function attachTargetedModifiers(): void {
    for (const context of contexts.values()) {
      if (context.kind !== "Modifier" || !context.entityId) continue;
      if (!context.ancestorTags.includes("forceEntry")) continue;
      const field = context.node.attributes.field;
      if (!field || !/^(?:[0-9a-f]{4}-){3}[0-9a-f]{4}$/iu.test(field)) continue;
      const targets = resolveTargetLike(field, context, upstreamIndex).filter(
        (candidate) => candidate.kind === "Constraint",
      );
      if (targets.length !== 1 || !targets[0]?.entityId) continue;
      const target = entities.get(targets[0].entityId);
      if (target && !target.modifierIds.includes(context.entityId))
        target.modifierIds.push(context.entityId);
    }
  }

  function referenceResolution(
    context: NodeContext,
    candidates: readonly NodeContext[],
  ): ReferenceResolution {
    const upstreamId = context.node.attributes.targetId ?? "";
    const resolved = candidates.length === 1 ? candidates[0] : undefined;
    if (resolved?.entityId)
      return {
        contractVersion: 1,
        state: "resolved",
        upstreamId,
        entityId: resolved.entityId,
        sourceNodeId: resolved.id,
        chain: [context.id, resolved.id],
      };
    if (candidates.length > 1)
      return {
        contractVersion: 1,
        state: "ambiguous",
        upstreamId,
        candidateEntityIds: candidates.flatMap((candidate) =>
          candidate.entityId ? [candidate.entityId] : [],
        ),
        chain: [context.id, ...candidates.map((candidate) => candidate.id)],
      };
    return { contractVersion: 1, state: "unresolved", upstreamId, chain: [context.id] };
  }
}

function isSlotKind(kind: EntityKind): kind is Slot["kind"] {
  return slotKinds.has(kind);
}

export function parseCostAmount(value: string | undefined): CostAmount {
  if (value === undefined || value.trim() === "") return { contractVersion: 1, state: "missing" };
  const normalized = value.trim().normalize("NFC");
  if (/^(?:n\/?a|not[ -]?applicable)$/iu.test(normalized))
    return { contractVersion: 1, state: "not-applicable", raw: normalized };
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(normalized))
    return { contractVersion: 1, state: "unknown", raw: normalized };
  const canonical = canonicalDecimal(normalized);
  return canonical === "0"
    ? { contractVersion: 1, state: "zero", value: "0" }
    : { contractVersion: 1, state: "value", value: canonical };
}

function canonicalDecimal(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const normalizedWhole = whole.replace(/^0+(?=\d)/u, "");
  const normalizedFraction = fraction.replace(/0+$/u, "");
  const magnitude = normalizedFraction
    ? `${normalizedWhole}.${normalizedFraction}`
    : normalizedWhole;
  return magnitude === "0" ? "0" : `${negative ? "-" : ""}${magnitude}`;
}

function kindOf(
  node: LosslessNode,
  ownerKind: EntityKind | null,
  vocabulary: DomainVocabulary,
): EntityKind | null {
  switch (node.tag) {
    case "gameSystem":
      return "GameSystem";
    case "catalogue":
      return "Faction";
    case "forceEntry":
      return "Battlefleet";
    case "categoryEntry":
      return "Category";
    case "categoryLink":
      return ownerKind === "Battlefleet" ? "BattlefleetElement" : null;
    case "selectionEntry": {
      const semantic = vocabularyKind(node.attributes.id, vocabulary);
      return (
        semantic ??
        (node.attributes.type === "unit"
          ? "Unit"
          : node.attributes.type === "model"
            ? "Model"
            : "Option")
      );
    }
    case "selectionEntryGroup":
      return (
        vocabularyKind(node.attributes.id, vocabulary) ??
        (containsWeaponProfile(node, vocabulary) ? "Hardpoint" : "OptionSlot")
      );
    case "profile":
      return vocabulary.weaponProfileTypeIds.has(node.attributes.typeId ?? "")
        ? "Weapon"
        : "Profile";
    case "rule":
      return "Rule";
    case "costType":
      return "CostType";
    case "cost":
      return "Cost";
    case "constraint":
      return "Constraint";
    case "conditionGroup":
      return "ConditionGroup";
    case "condition":
      return "Condition";
    case "modifier":
      return "Modifier";
    case "repeat":
      return "Repeat";
    default:
      return null;
  }
}

function vocabularyKind(id: string | undefined, vocabulary: DomainVocabulary): Slot["kind"] | null {
  if (!id) return null;
  if (vocabulary.generatorIds.has(id)) return "Generator";
  if (vocabulary.attachmentIds.has(id)) return "Attachment";
  if (vocabulary.escortIds.has(id)) return "Escort";
  if (vocabulary.doctrineIds.has(id)) return "Doctrine";
  return null;
}

function containsWeaponProfile(node: LosslessNode, vocabulary: DomainVocabulary): boolean {
  if (node.tag === "profile" && vocabulary.weaponProfileTypeIds.has(node.attributes.typeId ?? ""))
    return true;
  return (node.children ?? []).some((child) => containsWeaponProfile(child, vocabulary));
}

function identityQuality(node: LosslessNode): DomainEntity["identityQuality"] {
  if (!node.attributes.id) return "synthetic";
  return parseOccurrence(node.key) > 1 ? "scoped" : "upstream";
}

function labelsOf(
  node: LosslessNode,
  kind: EntityKind,
  normalizedLabel: string,
): DomainEntity["labels"] {
  const sourceLabel = node.attributes.name ?? node.text ?? null;
  const fallbackLabel = normalizedLabel || `${kind} (${node.attributes.id ?? "unknown"})`;
  const aliases = (node.attributes.aliases ?? "")
    .split(/[;,]/u)
    .map((value) => toSafePresentation(value).plainText)
    .filter(Boolean)
    .sort();
  return {
    contractVersion: 1,
    canonicalLabel: normalizedLabel || fallbackLabel,
    sourceLabel: sourceLabel === null ? null : toSafePresentation(sourceLabel).plainText,
    aliases,
    locale: "und",
    fallbackLabel,
  };
}

function costSemantics(
  context: NodeContext,
  upstreamIndex: ReadonlyMap<string, readonly NodeContext[]>,
): Extract<DomainEntity, { kind: "Cost" }>["semantics"] {
  const amount = parseCostAmount(context.node.attributes.value);
  const sourceCostTypeId = context.node.attributes.typeId ?? null;
  const costType = sourceCostTypeId
    ? upstreamIndex.get(sourceCostTypeId)?.find((candidate) => candidate.kind === "CostType")
    : undefined;
  const costTypeId = costType?.entityId ?? null;
  const resourceLabel = `${costType?.node.attributes.name ?? ""} ${sourceCostTypeId ?? ""}`
    .normalize("NFC")
    .toLowerCase();
  const resource = /victory|\bvp\b/u.test(resourceLabel)
    ? "victory-points"
    : /point|\bpts?\b/u.test(resourceLabel)
      ? "points"
      : sourceCostTypeId
        ? "other"
        : "unknown";
  const role = context.ancestorTags.some((tag) => linkTags.has(tag))
    ? "delta"
    : context.ancestorTags.includes("constraints")
      ? "limit"
      : "base";
  return {
    contractVersion: 1,
    amount,
    costTypeId,
    sourceCostTypeId,
    resource,
    role,
    scope: context.node.attributes.scope ?? null,
  };
}

function slotCardinality(node: LosslessNode): Slot["cardinality"] {
  let minimum: CostAmount = { contractVersion: 1, state: "missing" };
  let maximum: CostAmount = { contractVersion: 1, state: "missing" };
  const visit = (candidate: LosslessNode): void => {
    if (candidate.tag === "constraint" && candidate.attributes.field === "selections") {
      if (candidate.attributes.type === "min")
        minimum = parseCostAmount(candidate.attributes.value);
      if (candidate.attributes.type === "max")
        maximum = parseCostAmount(candidate.attributes.value);
    }
    for (const child of candidate.children ?? []) visit(child);
  };
  visit(node);
  return {
    contractVersion: 1,
    minimum,
    maximum,
    effective: "deferred-to-kan-32",
  };
}

function descriptionOf(
  node: LosslessNode,
): Pick<DomainEntity, "description"> | Record<string, never> {
  const description = (node.children ?? []).find(
    (child) => child.tag === "description" || child.tag === "comment",
  );
  if (!description) return {};
  return { description: presentationFromNode(description.text, description.richText) };
}

function fieldsOf(
  context: NodeContext,
  contexts: ReadonlyMap<string, NodeContext>,
  input: CatalogNormalizationInput,
): DomainEntity["fields"] {
  const fields: DomainEntity["fields"][number][] = [];
  let order = 0;
  const visit = (node: LosslessNode): void => {
    const childContext = contexts.get(node.key);
    if (childContext?.entityId) return;
    if (structuralContainers.has(node.tag)) {
      for (const child of node.children ?? []) visit(child);
      return;
    }
    if (new Set(["alias", "comment", "description"]).has(node.tag)) return;
    if (!fieldTags.has(node.tag)) return;
    if (!childContext) return;
    fields.push({
      contractVersion: 1,
      sourceTag: node.tag,
      order: order++,
      label: toSafePresentation(node.attributes.name ?? node.tag),
      value: presentationFromNode(node.text, node.richText),
      attributes: safeAttributes(node.attributes),
      provenance: provenanceOf(childContext, input),
    });
  };
  for (const child of context.node.children ?? []) visit(child);
  return fields;
}

function extensionsOf(
  context: NodeContext,
  contexts: ReadonlyMap<string, NodeContext>,
  input: CatalogNormalizationInput,
): readonly LosslessExtension[] {
  const handledFields = new Set(["alias", "attribute", "characteristic", "comment", "description"]);
  const extensions: LosslessExtension[] = [];
  let order = 0;
  const visit = (node: LosslessNode): void => {
    const childContext = contexts.get(node.key);
    if (childContext?.entityId) return;
    if (structuralContainers.has(node.tag)) {
      for (const child of node.children ?? []) visit(child);
      return;
    }
    if (handledFields.has(node.tag) || linkTags.has(node.tag)) {
      for (const child of node.children ?? []) visit(child);
      return;
    }
    if (!childContext) return;
    extensions.push(extensionOf(childContext, input, order++));
  };
  for (const child of context.node.children ?? []) visit(child);
  return extensions;
}

function extensionOf(
  context: NodeContext,
  input: CatalogNormalizationInput,
  order: number,
): LosslessExtension {
  return {
    contractVersion: 1,
    sourceTag: context.node.tag,
    order,
    attributes: safeAttributes(context.node.attributes),
    value: presentationFromNode(context.node.text, context.node.richText),
    children: (context.node.children ?? []).map((child, childOrder) =>
      extensionOf(
        {
          ...context,
          node: child,
          id: sourceNodeId(
            context.rootId,
            child.tag,
            upstreamIdFromKey(child.key, child.attributes.id),
            parseOccurrence(child.key),
          ),
        },
        input,
        childOrder,
      ),
    ),
    provenance: provenanceOf(context, input),
  };
}

function safeAttributes(
  attributes: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(attributes)
      .map(([key, value]) => [key, presentationAttribute(key, value)] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function presentationAttribute(key: string, value: string): string {
  return /(?:name|label|description|comment|url|contact|publisher)/iu.test(key)
    ? toSafePresentation(value).plainText
    : value.normalize("NFC");
}

function expressionOf(
  context: NodeContext,
  upstreamIndex: ReadonlyMap<string, readonly NodeContext[]>,
  diagnostics: DomainDiagnostic[],
): EvaluatorExpression {
  const attributes = context.node.attributes;
  const operator = attributes.type ?? null;
  const field = attributes.field ?? null;
  const scope = attributes.scope ?? null;
  const candidates = resolveTargetLike(attributes.childId, context, upstreamIndex);
  const references = candidates.flatMap((candidate) =>
    candidate.entityId ? [candidate.entityId] : [],
  );
  const reasons: string[] = [];
  const operatorKnown =
    context.kind === "Modifier"
      ? operator !== null && knownModifierOperators.has(operator)
      : context.kind === "ConditionGroup"
        ? operator !== null && knownConditionGroupOperators.has(operator)
        : context.kind === "Constraint"
          ? operator !== null && new Set(["max", "min"]).has(operator)
          : context.kind === "Repeat"
            ? true
            : operator !== null && knownConditionOperators.has(operator);
  if (!operatorKnown) reasons.push("UNKNOWN_OPERATOR");
  if (field !== null && !isKnownField(field)) reasons.push("UNKNOWN_FIELD");
  if (scope !== null && !isKnownScope(scope)) reasons.push("UNKNOWN_SCOPE");
  if (attributes.childId && candidates.length !== 1)
    reasons.push(
      candidates.length > 1 ? "AMBIGUOUS_ENTITY_REFERENCE" : "UNRESOLVED_ENTITY_REFERENCE",
    );
  if (reasons.length > 0)
    diagnostics.push({
      code: "UNEVALUABLE_EXPRESSION",
      severity: "warning",
      sourceNodeId: context.id,
      detail: { reasons: reasons.join(","), kind: context.kind ?? "unknown" },
    });
  const flags = Object.fromEntries(
    Object.entries(attributes)
      .filter(
        ([key]) => !new Set(["type", "field", "scope", "value", "childId", "childName"]).has(key),
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    contractVersion: 1,
    operator,
    field,
    scope,
    value: attributes.value ?? null,
    references,
    referenceResolutions: attributes.childId
      ? [expressionResolution(attributes.childId, context, candidates)]
      : [],
    flags,
    evaluable: reasons.length === 0,
    unevaluableReasons: reasons,
  };
}

function expressionResolution(
  upstreamId: string,
  context: NodeContext,
  candidates: readonly NodeContext[],
): ReferenceResolution {
  const target = candidates.length === 1 ? candidates[0] : undefined;
  if (target?.entityId)
    return {
      contractVersion: 1,
      state: "resolved",
      upstreamId,
      entityId: target.entityId,
      sourceNodeId: target.id,
      chain: [context.id, target.id],
    };
  if (candidates.length > 1)
    return {
      contractVersion: 1,
      state: "ambiguous",
      upstreamId,
      candidateEntityIds: candidates.flatMap((candidate) =>
        candidate.entityId ? [candidate.entityId] : [],
      ),
      chain: [context.id, ...candidates.map((candidate) => candidate.id)],
    };
  return { contractVersion: 1, state: "unresolved", upstreamId, chain: [context.id] };
}

function isKnownField(value: string): boolean {
  return knownFields.has(value) || /^(?:[0-9a-f]{4}-){3}[0-9a-f]{4}$/iu.test(value);
}

function isKnownScope(value: string): boolean {
  return knownScopes.has(value) || /^(?:[0-9a-f]{4}-){3}[0-9a-f]{4}$/iu.test(value);
}

function resolveTarget(
  node: LosslessNode,
  contexts: ReadonlyMap<string, NodeContext>,
  upstreamIndex: ReadonlyMap<string, readonly NodeContext[]>,
): NodeContext[] {
  if (node.target) {
    const target = contexts.get(node.target);
    return target ? [target] : [];
  }
  return resolveTargetLike(node.attributes.targetId, null, upstreamIndex);
}

function resolveTargetLike(
  upstreamId: string | undefined,
  source: NodeContext | null,
  upstreamIndex: ReadonlyMap<string, readonly NodeContext[]>,
): NodeContext[] {
  if (!upstreamId) return [];
  const all = [...(upstreamIndex.get(upstreamId) ?? [])];
  const local = source
    ? all.filter((context) => context.document.path === source.document.path)
    : [];
  return local.length > 0 ? local : all;
}

function createPlacement(
  context: NodeContext,
  contexts: ReadonlyMap<string, NodeContext>,
  input: CatalogNormalizationInput,
  ownerId: EntityId,
  ownerSlot: SlotId | null,
  order: number,
  definitionId: EntityId | null,
  linkKind: Placement["linkKind"],
  resolved: boolean,
  ambiguous: boolean,
  targetSourceNodeId: SourceNodeId | null,
  resolution: ReferenceResolution | null,
): Placement {
  const overlay = overlayOf(context, contexts);
  return {
    contractVersion: 1,
    id: placementId(ownerId, context.id, order, linkKind),
    ownerId,
    definitionId,
    slotId: ownerSlot,
    order,
    linkKind,
    resolved,
    ambiguous,
    targetSourceNodeId,
    resolution,
    overlay,
    provenance: provenanceOf(context, input),
  };
}

function overlayOf(
  context: NodeContext,
  contexts: ReadonlyMap<string, NodeContext>,
): PlacementOverlay {
  const relationIds = (tags: ReadonlySet<string>): EntityId[] => {
    const result = new Set<EntityId>();
    const visit = (node: LosslessNode): void => {
      const childContext = contexts.get(node.key);
      if (childContext?.entityId && tags.has(childContext.kind ?? ""))
        result.add(childContext.entityId);
      else if (node.tag === "categoryLink" && node.target && tags.has("Category")) {
        const target = contexts.get(node.target);
        if (target?.entityId && target.kind === "Category") result.add(target.entityId);
      } else if (structuralContainers.has(node.tag))
        for (const child of node.children ?? []) visit(child);
    };
    for (const child of context.node.children ?? []) visit(child);
    return [...result].sort();
  };
  return {
    categoryIds: relationIds(new Set(["Category"])),
    costIds: relationIds(new Set(["Cost"])),
    constraintIds: relationIds(new Set(["Constraint"])),
    conditionIds: relationIds(new Set(["Condition", "ConditionGroup"])),
    modifierIds: relationIds(new Set(["Modifier"])),
    repeatIds: relationIds(new Set(["Repeat"])),
    attributes: safeAttributes(context.node.attributes),
    cardinality: slotCardinality(context.node),
  };
}

function attach(owner: MutableEntity | undefined, kind: EntityKind | null, id: EntityId): void {
  if (!owner || !kind) return;
  if (kind === "Category") owner.categoryIds.push(id);
  else if (kind === "Cost") owner.costIds.push(id);
  else if (kind === "Constraint") owner.constraintIds.push(id);
  else if (kind === "Condition" || kind === "ConditionGroup") owner.conditionIds.push(id);
  else if (kind === "Modifier") owner.modifierIds.push(id);
  else if (kind === "Repeat") owner.repeatIds.push(id);
  else if (kind === "Profile" || kind === "Weapon") owner.profileIds.push(id);
  else if (kind === "Rule") owner.ruleIds.push(id);
}

function provenanceOf(context: NodeContext, input: CatalogNormalizationInput): Provenance {
  return {
    source: input.source,
    documentPath: context.document.path,
    documentBlob: context.document.blob,
    documentSha256: context.document.sha256,
    documentRootId: context.rootId,
    sourceNodeId: context.id,
    sourceTag: context.node.tag,
    upstreamId: context.node.attributes.id ?? null,
    occurrence: parseOccurrence(context.node.key),
    xmlPath: context.node.key,
    resolutionChain: [context.id],
    sourceRevision: input.source.commit,
    importRevision: input.graph.schemaVersion,
    schemaRevision: DOMAIN_SCHEMA_VERSION,
  };
}

function validateInput(input: CatalogNormalizationInput): void {
  const diagnostics: DomainDiagnostic[] = [];
  if (input.graph.schemaVersion !== 2)
    diagnostics.push({
      code: "GRAPH_SCHEMA_UNSUPPORTED",
      severity: "fatal",
      detail: { actual: input.graph.schemaVersion, expected: 2 },
    });
  if (!/^[0-9a-f]{40}$/u.test(input.source.commit))
    diagnostics.push({
      code: "SOURCE_COMMIT_INVALID",
      severity: "fatal",
      detail: { commit: input.source.commit },
    });
  if (!/^[0-9a-f]{40}$/u.test(input.source.tree))
    diagnostics.push({
      code: "SOURCE_TREE_INVALID",
      severity: "fatal",
      detail: { tree: input.source.tree },
    });
  if (input.graph.documents.length === 0)
    diagnostics.push({ code: "DOCUMENTS_EMPTY", severity: "fatal", detail: {} });
  if (diagnostics.length > 0) throw new DomainNormalizationError(diagnostics);
}

function sortedRecord<Value>(values: ReadonlyMap<string, Value>): Record<string, Value> {
  return Object.fromEntries(
    [...values.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function compareDiagnostics(left: DomainDiagnostic, right: DomainDiagnostic): number {
  return `${left.severity}:${left.code}:${left.sourceNodeId ?? ""}`.localeCompare(
    `${right.severity}:${right.code}:${right.sourceNodeId ?? ""}`,
  );
}
