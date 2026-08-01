import {
  entityId,
  parseOccurrence,
  placementId,
  slotId,
  sourceNodeId,
  upstreamIdFromKey,
} from "./identifiers";
import { presentationFromNode, toSafePresentation } from "./presentation";
import {
  DOMAIN_SCHEMA_VERSION,
  type CatalogNormalizationInput,
  type CostAmount,
  type DomainCatalog,
  type DomainDiagnostic,
  type DomainEntity,
  type EntityId,
  type EntityKind,
  type EvaluatorExpression,
  type LosslessDocument,
  type LosslessNode,
  type MigrationAlias,
  type NormalizationOptions,
  type Placement,
  type PlacementOverlay,
  type Provenance,
  type Slot,
  type SlotId,
  type SourceNodeId,
} from "./types";

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
]);
const knownModifierOperators = new Set([
  "add",
  "append",
  "decrement",
  "increment",
  "multiply",
  "set",
]);
const knownConditionGroupOperators = new Set(["and", "or"]);
const knownFields = new Set([
  "forces",
  "selections",
  "limit::category",
  "limit::selection",
  "cost",
  "name",
]);
const knownScopes = new Set(["force", "parent", "root-entry", "roster", "self"]);

interface NodeContext {
  readonly document: LosslessDocument;
  readonly rootId: string;
  readonly node: LosslessNode;
  readonly id: SourceNodeId;
  readonly entityId: EntityId | null;
  readonly kind: EntityKind | null;
}

interface MutableEntity extends Omit<
  DomainEntity,
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
}

interface MutableSlot extends Omit<Slot, "placementIds"> {
  placementIds: Placement["id"][];
}

export class DomainNormalizationError extends Error {
  constructor(readonly diagnostics: readonly DomainDiagnostic[]) {
    super("Domain catalog normalization failed");
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
  const entities = new Map<string, MutableEntity>();
  const placements = new Map<string, Placement>();
  const slots = new Map<string, MutableSlot>();
  const aliases = new Map<string, MigrationAlias>();
  const contexts = new Map<string, NodeContext>();
  const upstreamIndex = new Map<string, NodeContext[]>();
  const rootEntityIds: EntityId[] = [];

  for (const document of input.graph.documents) {
    const rootUpstreamId = document.root.attributes.id ?? upstreamIdFromKey(document.root.key);
    collectContexts(document.root, document, rootUpstreamId, null);
    options.observeMemoryCheckpoint?.();
  }

  let normalizedEntities = 0;
  for (const context of contexts.values()) {
    if (!context.kind || !context.entityId) continue;
    const node = context.node;
    const entity: MutableEntity = {
      id: context.entityId,
      kind: context.kind,
      sourceTag: node.tag,
      identityQuality: identityQuality(node),
      label: toSafePresentation(node.attributes.name ?? node.text ?? context.kind),
      ...descriptionOf(node),
      attributes: safeAttributes(node.attributes),
      fields: fieldsOf(context, contexts, input),
      categoryIds: [],
      costIds: [],
      constraintIds: [],
      conditionIds: [],
      modifierIds: [],
      repeatIds: [],
      profileIds: [],
      ruleIds: [],
      slotIds: [],
      ...(context.kind === "Cost" ? { amount: parseCostAmount(node.attributes.value) } : {}),
      ...(expressionKinds.has(context.kind)
        ? { expression: expressionOf(context, upstreamIndex, diagnostics) }
        : {}),
      provenance: provenanceOf(context, input),
    };
    entities.set(entity.id, entity);
    if (context.node === context.document.root) rootEntityIds.push(entity.id);
    if (entity.identityQuality !== "stable") {
      diagnostics.push({
        code:
          entity.identityQuality === "duplicate" ? "DUPLICATE_UPSTREAM_ID" : "SYNTHETIC_IDENTITY",
        severity: "warning",
        sourceNodeId: context.id,
        detail: { identityQuality: entity.identityQuality, entityId: entity.id },
      });
    }
    if (isSlotKind(context.kind)) {
      const id = slotId(entity.id);
      entity.slotIds.push(id);
      slots.set(id, {
        id,
        ownerId: entity.id,
        kind: context.kind,
        label: entity.label,
        placementIds: [],
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

  const fatal = diagnostics.filter((diagnostic) => diagnostic.severity === "fatal");
  if (fatal.length > 0) throw new DomainNormalizationError(fatal);
  options.observeMemoryCheckpoint?.();

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    contentVersion: "unversioned",
    source: input.source,
    entities: sortedRecord(entities),
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
  ): void {
    const upstreamId = upstreamIdFromKey(node.key, node.attributes.id);
    const id = sourceNodeId(rootId, node.tag, upstreamId, parseOccurrence(node.key));
    const kind = kindOf(node, ownerKind);
    const context = { document, rootId, node, id, entityId: kind ? entityId(id) : null, kind };
    contexts.set(node.key, context);
    if (node.attributes.id && context.entityId) {
      const matches = upstreamIndex.get(node.attributes.id) ?? [];
      matches.push(context);
      upstreamIndex.set(node.attributes.id, matches);
    }
    for (const child of node.children ?? [])
      collectContexts(child, document, rootId, kind ?? ownerKind);
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
      );
      placements.set(placement.id, placement);
      if (ownerSlot) slots.get(ownerSlot)?.placementIds.push(placement.id);
      attach(entities.get(ownerId), context.kind, context.entityId);
    }

    if (linkTags.has(context.node.tag) && ownerId) {
      const candidates = resolveTarget(context.node, contexts, upstreamIndex);
      const definitionId = candidates.length === 1 ? (candidates[0]?.entityId ?? null) : null;
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
      );
      placements.set(placement.id, placement);
      if (ownerSlot) slots.get(ownerSlot)?.placementIds.push(placement.id);
      if (definitionId) attach(entities.get(ownerId), candidates[0]?.kind ?? null, definitionId);
      else {
        diagnostics.push({
          code: candidates.length > 1 ? "AMBIGUOUS_REFERENCE" : "UNRESOLVED_REFERENCE",
          severity: "warning",
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
        alias,
        entityIds: [target],
        ambiguous: false,
        provenance: provenanceOf(context, input),
        explicit: true,
      });
  }
}

function isSlotKind(kind: EntityKind): kind is Slot["kind"] {
  return slotKinds.has(kind);
}

export function parseCostAmount(value: string | undefined): CostAmount {
  if (value === undefined || value.trim() === "") return { state: "missing" };
  const normalized = value.trim().normalize("NFC");
  if (/^(?:n\/?a|not[ -]?applicable)$/iu.test(normalized))
    return { state: "not-applicable", raw: normalized };
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(normalized))
    return { state: "unknown", raw: normalized };
  const canonical = canonicalDecimal(normalized);
  return canonical === "0" ? { state: "zero", value: "0" } : { state: "value", value: canonical };
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

function kindOf(node: LosslessNode, ownerKind: EntityKind | null = null): EntityKind | null {
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
      const semantic = semanticNamedKind(node.attributes.name);
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
      return semanticSlotKind(node.attributes.name);
    case "profile":
      return /weapon/iu.test(node.attributes.typeName ?? "") ? "Weapon" : "Profile";
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

function semanticSlotKind(name: string | undefined): EntityKind {
  return (
    semanticNamedKind(name) ??
    (/battlefleet|element/iu.test(name?.normalize("NFC") ?? "")
      ? "BattlefleetElement"
      : "OptionSlot")
  );
}

function semanticNamedKind(name: string | undefined): Slot["kind"] | null {
  const value = name?.normalize("NFC") ?? "";
  if (/hardpoint/iu.test(value)) return "Hardpoint";
  if (/generator/iu.test(value)) return "Generator";
  if (/attachment/iu.test(value)) return "Attachment";
  if (/escort/iu.test(value)) return "Escort";
  if (/doctrine/iu.test(value)) return "Doctrine";
  return null;
}

function identityQuality(node: LosslessNode): DomainEntity["identityQuality"] {
  if (!node.attributes.id) return "synthetic";
  return parseOccurrence(node.key) > 1 ? "duplicate" : "stable";
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
    if (!childContext) return;
    fields.push({
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
    operator,
    field,
    scope,
    value: attributes.value ?? null,
    references,
    flags,
    evaluable: reasons.length === 0,
    unevaluableReasons: reasons,
  };
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
): Placement {
  const overlay = overlayOf(context, contexts);
  return {
    id: placementId(ownerId, context.id, order, linkKind),
    ownerId,
    definitionId,
    slotId: ownerSlot,
    order,
    linkKind,
    resolved,
    ambiguous,
    targetSourceNodeId,
    overlay,
    provenance: provenanceOf(context, input),
  };
}

function overlayOf(
  context: NodeContext,
  contexts: ReadonlyMap<string, NodeContext>,
): PlacementOverlay {
  const relationIds = (tags: ReadonlySet<string>): EntityId[] => {
    const result: EntityId[] = [];
    const visit = (node: LosslessNode): void => {
      const childContext = contexts.get(node.key);
      if (childContext?.entityId && tags.has(childContext.kind ?? ""))
        result.push(childContext.entityId);
      else if (structuralContainers.has(node.tag))
        for (const child of node.children ?? []) visit(child);
    };
    for (const child of context.node.children ?? []) visit(child);
    return result.sort();
  };
  return {
    categoryIds: relationIds(new Set(["Category"])),
    costIds: relationIds(new Set(["Cost"])),
    constraintIds: relationIds(new Set(["Constraint"])),
    conditionIds: relationIds(new Set(["Condition", "ConditionGroup"])),
    modifierIds: relationIds(new Set(["Modifier"])),
    repeatIds: relationIds(new Set(["Repeat"])),
    attributes: safeAttributes(context.node.attributes),
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
