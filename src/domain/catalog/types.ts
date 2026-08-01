export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type EntityId = Brand<string, "EntityId">;
export type PlacementId = Brand<string, "PlacementId">;
export type SlotId = Brand<string, "SlotId">;
export type SourceNodeId = Brand<string, "SourceNodeId">;

export const DOMAIN_SCHEMA_VERSION = "1.0.0" as const;

export const entityKinds = [
  "GameSystem",
  "Faction",
  "Battlefleet",
  "BattlefleetElement",
  "Category",
  "Unit",
  "Model",
  "Profile",
  "Weapon",
  "OptionSlot",
  "Option",
  "Hardpoint",
  "Generator",
  "Attachment",
  "Escort",
  "Doctrine",
  "Rule",
  "CostType",
  "Cost",
  "Constraint",
  "ConditionGroup",
  "Condition",
  "Modifier",
  "Repeat",
] as const;

export type EntityKind = (typeof entityKinds)[number];
export type IdentityQuality = "stable" | "duplicate" | "synthetic";
export type Severity = "warning" | "fatal";

export interface DomainDiagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly sourceNodeId?: SourceNodeId;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}

export interface RichTextInline {
  readonly type: "text" | "strong" | "lineBreak";
  readonly value?: string;
}

export interface RichTextParagraph {
  readonly type: "paragraph";
  readonly children: readonly RichTextInline[];
}

export interface SafePresentation {
  readonly plainText: string;
  readonly blocks: readonly RichTextParagraph[];
  readonly contentUnavailable: boolean;
  readonly diagnostics: readonly string[];
}

export interface SourcePin {
  readonly repository: string;
  readonly commit: string;
  readonly tree: string;
  readonly commitTimestamp: string;
}

export interface Provenance {
  readonly source: SourcePin;
  readonly documentPath: string;
  readonly documentBlob: string;
  readonly documentSha256: string;
  readonly documentRootId: string;
  readonly sourceNodeId: SourceNodeId;
  readonly sourceTag: string;
  readonly upstreamId: string | null;
}

export type CostAmount =
  | { readonly state: "missing" }
  | { readonly state: "unknown"; readonly raw: string }
  | { readonly state: "not-applicable"; readonly raw: string }
  | { readonly state: "zero"; readonly value: "0" }
  | { readonly state: "value"; readonly value: string };

export interface EvaluatorExpression {
  readonly operator: string | null;
  readonly field: string | null;
  readonly scope: string | null;
  readonly value: string | null;
  readonly references: readonly EntityId[];
  readonly flags: Readonly<Record<string, string>>;
  readonly evaluable: boolean;
  readonly unevaluableReasons: readonly string[];
}

export interface DomainField {
  readonly sourceTag: string;
  readonly order: number;
  readonly label: SafePresentation;
  readonly value: SafePresentation;
  readonly attributes: Readonly<Record<string, string>>;
  readonly provenance: Provenance;
}

export interface DomainEntity {
  readonly id: EntityId;
  readonly kind: EntityKind;
  readonly sourceTag: string;
  readonly identityQuality: IdentityQuality;
  readonly label: SafePresentation;
  readonly description?: SafePresentation;
  readonly attributes: Readonly<Record<string, string>>;
  readonly fields: readonly DomainField[];
  readonly categoryIds: readonly EntityId[];
  readonly costIds: readonly EntityId[];
  readonly constraintIds: readonly EntityId[];
  readonly conditionIds: readonly EntityId[];
  readonly modifierIds: readonly EntityId[];
  readonly repeatIds: readonly EntityId[];
  readonly profileIds: readonly EntityId[];
  readonly ruleIds: readonly EntityId[];
  readonly slotIds: readonly SlotId[];
  readonly amount?: CostAmount;
  readonly expression?: EvaluatorExpression;
  readonly provenance: Provenance;
}

export interface PlacementOverlay {
  readonly categoryIds: readonly EntityId[];
  readonly costIds: readonly EntityId[];
  readonly constraintIds: readonly EntityId[];
  readonly conditionIds: readonly EntityId[];
  readonly modifierIds: readonly EntityId[];
  readonly repeatIds: readonly EntityId[];
  readonly attributes: Readonly<Record<string, string>>;
}

export interface Placement {
  readonly id: PlacementId;
  readonly ownerId: EntityId;
  readonly definitionId: EntityId | null;
  readonly slotId: SlotId | null;
  readonly order: number;
  readonly linkKind: "ownership" | "reference";
  readonly resolved: boolean;
  readonly ambiguous: boolean;
  readonly targetSourceNodeId: SourceNodeId | null;
  readonly overlay: PlacementOverlay;
  readonly provenance: Provenance;
}

export interface Slot {
  readonly id: SlotId;
  readonly ownerId: EntityId;
  readonly kind: "OptionSlot" | "Hardpoint" | "Generator" | "Attachment" | "Escort" | "Doctrine";
  readonly label: SafePresentation;
  readonly placementIds: readonly PlacementId[];
  readonly provenance: Provenance;
}

export interface MigrationAlias {
  readonly alias: EntityId;
  readonly entityIds: readonly EntityId[];
  readonly ambiguous: boolean;
  readonly provenance: Provenance;
  readonly explicit: true;
}

export interface DomainCatalog {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly contentVersion: string;
  readonly source: SourcePin;
  readonly entities: Readonly<Record<string, DomainEntity>>;
  readonly placements: Readonly<Record<string, Placement>>;
  readonly slots: Readonly<Record<string, Slot>>;
  readonly aliases: Readonly<Record<string, MigrationAlias>>;
  readonly roots: readonly EntityId[];
  readonly diagnostics: readonly DomainDiagnostic[];
}

export interface LosslessNode {
  readonly key: string;
  readonly tag: string;
  readonly namespace?: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children?: readonly LosslessNode[];
  readonly text?: string;
  readonly richText?: {
    readonly plainText?: string;
    readonly contentUnavailable?: boolean;
    readonly diagnostics?: readonly { readonly code?: string; readonly tag?: string }[];
  };
  readonly target?: string;
}

export interface LosslessDocument {
  readonly path: string;
  readonly blob: string;
  readonly sha256: string;
  readonly root: LosslessNode;
}

export interface LosslessGraph {
  readonly schemaVersion: number;
  readonly documents: readonly LosslessDocument[];
}

export interface CatalogNormalizationInput {
  readonly graph: LosslessGraph;
  readonly source: SourcePin;
}

export interface NormalizationOptions {
  readonly observeMemoryCheckpoint?: () => void;
}

export interface ContentHasher {
  sha256(value: string): Promise<string>;
}

export interface CatalogChunk {
  readonly id: string;
  readonly kind: "entities" | "placements" | "slots" | "aliases" | "diagnostics" | "metadata";
  readonly sha256: string;
  readonly bytes: number;
  readonly value: string;
}

export interface CatalogIndex {
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly contentVersion: string;
  readonly chunks: readonly Omit<CatalogChunk, "value">[];
  readonly entityChunkById: Readonly<Record<string, string>>;
  readonly placementChunkById: Readonly<Record<string, string>>;
  readonly slotChunkById: Readonly<Record<string, string>>;
}

export interface ChunkedDomainCatalog {
  readonly index: CatalogIndex;
  readonly chunks: Readonly<Record<string, string>>;
}

export interface DomainCatalogRepository {
  loadIndex(contentVersion: string): Promise<CatalogIndex>;
  loadChunk(sha256: string): Promise<string>;
}
