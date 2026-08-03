export type Brand<Value, Name extends string> = Value & { readonly __brand: Name };

export type EntityId = Brand<string, "EntityId">;
export type PlacementId = Brand<string, "PlacementId">;
export type SlotId = Brand<string, "SlotId">;
export type SourceNodeId = Brand<string, "SourceNodeId">;

export const DOMAIN_SCHEMA_VERSION = "1.0.0" as const;
export const DOMAIN_CONTRACT_VERSION = 1 as const;

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
export type IdentityQuality = "upstream" | "scoped" | "synthetic";
export type Severity = "warning" | "fatal";

export interface DomainDiagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly sourceNodeId?: SourceNodeId;
  readonly detail: Readonly<Record<string, string | number | boolean | null>>;
}

export interface RichTextInline {
  readonly type: "text" | "strong" | "emphasis" | "lineBreak" | "reference";
  readonly value?: string;
  readonly reference?: {
    readonly state: "resolved" | "unresolved";
    readonly target: string;
  };
}

export interface RichTextParagraph {
  readonly type: "paragraph";
  readonly children: readonly RichTextInline[];
}

export interface RichTextTableCell {
  readonly type: "tableCell";
  readonly header: boolean;
  readonly children: readonly RichTextInline[];
}

export interface RichTextTableRow {
  readonly type: "tableRow";
  readonly cells: readonly RichTextTableCell[];
}

export interface RichTextTable {
  readonly type: "table";
  readonly rows: readonly RichTextTableRow[];
}

export interface RichTextListItem {
  readonly type: "listItem";
  readonly children: readonly RichTextInline[];
}

export interface RichTextList {
  readonly type: "list";
  readonly ordered: boolean;
  readonly items: readonly RichTextListItem[];
}

export type RichTextBlock = RichTextParagraph | RichTextTable | RichTextList;

export interface SafePresentation {
  readonly plainText: string;
  readonly blocks: readonly RichTextBlock[];
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
  readonly occurrence: number;
  readonly xmlPath: string;
  readonly resolutionChain: readonly SourceNodeId[];
  readonly sourceRevision: string;
  readonly importRevision: number;
  readonly schemaRevision: typeof DOMAIN_SCHEMA_VERSION;
}

export interface DomainLabels {
  readonly contractVersion: 1;
  readonly canonicalLabel: string;
  readonly sourceLabel: string | null;
  readonly aliases: readonly string[];
  readonly locale: "und";
  readonly fallbackLabel: string;
}

export interface DomainIdentity {
  readonly contractVersion: 1;
  readonly canonicalId: EntityId;
  readonly sourceNodeId: SourceNodeId;
  readonly upstreamId: string | null;
  readonly occurrence: number;
  readonly quality: IdentityQuality;
  readonly migrationAliasIds: readonly EntityId[];
}

export type CostAmount =
  | { readonly contractVersion: 1; readonly state: "missing" }
  | { readonly contractVersion: 1; readonly state: "unknown"; readonly raw: string }
  | { readonly contractVersion: 1; readonly state: "not-applicable"; readonly raw: string }
  | { readonly contractVersion: 1; readonly state: "zero"; readonly value: "0" }
  | { readonly contractVersion: 1; readonly state: "value"; readonly value: string };

export type ReferenceResolution =
  | {
      readonly contractVersion: 1;
      readonly state: "resolved";
      readonly upstreamId: string;
      readonly entityId: EntityId;
      readonly sourceNodeId: SourceNodeId;
      readonly chain: readonly SourceNodeId[];
    }
  | {
      readonly contractVersion: 1;
      readonly state: "unresolved";
      readonly upstreamId: string;
      readonly chain: readonly SourceNodeId[];
    }
  | {
      readonly contractVersion: 1;
      readonly state: "ambiguous";
      readonly upstreamId: string;
      readonly candidateEntityIds: readonly EntityId[];
      readonly chain: readonly SourceNodeId[];
    };

export interface EvaluatorExpression {
  readonly contractVersion: 1;
  readonly operator: string | null;
  readonly field: string | null;
  readonly scope: string | null;
  readonly value: string | null;
  readonly references: readonly EntityId[];
  readonly referenceResolutions: readonly ReferenceResolution[];
  readonly flags: Readonly<Record<string, string>>;
  readonly evaluable: boolean;
  readonly unevaluableReasons: readonly string[];
}

export interface DomainField {
  readonly contractVersion: 1;
  readonly sourceTag: string;
  readonly order: number;
  readonly label: SafePresentation;
  readonly value: SafePresentation;
  readonly attributes: Readonly<Record<string, string>>;
  readonly provenance: Provenance;
}

export interface LosslessExtension {
  readonly contractVersion: 1;
  readonly sourceTag: string;
  readonly order: number;
  readonly attributes: Readonly<Record<string, string>>;
  readonly value: SafePresentation;
  readonly children: readonly LosslessExtension[];
  readonly provenance: Provenance;
}

export interface DomainEntityBase<Kind extends EntityKind> {
  readonly contractVersion: 1;
  readonly id: EntityId;
  readonly kind: Kind;
  readonly sourceTag: string;
  readonly identityQuality: IdentityQuality;
  readonly identity: DomainIdentity;
  readonly label: SafePresentation;
  readonly labels: DomainLabels;
  readonly description?: SafePresentation;
  readonly attributes: Readonly<Record<string, string>>;
  readonly fields: readonly DomainField[];
  readonly extensions: readonly LosslessExtension[];
  readonly categoryIds: readonly EntityId[];
  readonly costIds: readonly EntityId[];
  readonly constraintIds: readonly EntityId[];
  readonly conditionIds: readonly EntityId[];
  readonly modifierIds: readonly EntityId[];
  readonly repeatIds: readonly EntityId[];
  readonly profileIds: readonly EntityId[];
  readonly ruleIds: readonly EntityId[];
  readonly slotIds: readonly SlotId[];
  readonly provenance: Provenance;
}

export type GameSystem = DomainEntityBase<"GameSystem">;
export type Faction = DomainEntityBase<"Faction">;
export type Battlefleet = DomainEntityBase<"Battlefleet">;
export type BattlefleetElement = DomainEntityBase<"BattlefleetElement">;
export type Category = DomainEntityBase<"Category">;
export type Unit = DomainEntityBase<"Unit">;
export type Model = DomainEntityBase<"Model">;
export type Profile = DomainEntityBase<"Profile">;
export type Weapon = DomainEntityBase<"Weapon">;
export type OptionSlot = DomainEntityBase<"OptionSlot">;
export type Option = DomainEntityBase<"Option">;
export type Hardpoint = DomainEntityBase<"Hardpoint">;
export type Generator = DomainEntityBase<"Generator">;
export type Attachment = DomainEntityBase<"Attachment">;
export type Escort = DomainEntityBase<"Escort">;
export type Doctrine = DomainEntityBase<"Doctrine">;
export type Rule = DomainEntityBase<"Rule">;
export type CostType = DomainEntityBase<"CostType">;
export interface CostSemantics {
  readonly contractVersion: 1;
  readonly amount: CostAmount;
  readonly costTypeId: EntityId | null;
  readonly sourceCostTypeId: string | null;
  readonly resource: "points" | "victory-points" | "other" | "unknown";
  readonly role: "base" | "delta" | "limit" | "unknown";
  readonly scope: string | null;
}

export type Cost = DomainEntityBase<"Cost"> & {
  readonly amount: CostAmount;
  readonly semantics: CostSemantics;
};
export type Constraint = DomainEntityBase<"Constraint"> & {
  readonly expression: EvaluatorExpression;
};
export type ConditionGroup = DomainEntityBase<"ConditionGroup"> & {
  readonly expression: EvaluatorExpression;
};
export type Condition = DomainEntityBase<"Condition"> & {
  readonly expression: EvaluatorExpression;
};
export type Modifier = DomainEntityBase<"Modifier"> & { readonly expression: EvaluatorExpression };
export type Repeat = DomainEntityBase<"Repeat"> & { readonly expression: EvaluatorExpression };

export type DomainEntity =
  | GameSystem
  | Faction
  | Battlefleet
  | BattlefleetElement
  | Category
  | Unit
  | Model
  | Profile
  | Weapon
  | OptionSlot
  | Option
  | Hardpoint
  | Generator
  | Attachment
  | Escort
  | Doctrine
  | Rule
  | CostType
  | Cost
  | Constraint
  | ConditionGroup
  | Condition
  | Modifier
  | Repeat;

export interface PlacementOverlay {
  readonly categoryIds: readonly EntityId[];
  readonly costIds: readonly EntityId[];
  readonly constraintIds: readonly EntityId[];
  readonly conditionIds: readonly EntityId[];
  readonly modifierIds: readonly EntityId[];
  readonly repeatIds: readonly EntityId[];
  readonly attributes: Readonly<Record<string, string>>;
  readonly cardinality?: SelectionCardinality;
}

export interface SelectionCardinality {
  readonly contractVersion: 1;
  readonly minimum: CostAmount;
  readonly maximum: CostAmount;
  readonly effective: "deferred-to-kan-32";
}

export interface Placement {
  readonly contractVersion: 1;
  readonly id: PlacementId;
  readonly ownerId: EntityId;
  readonly definitionId: EntityId | null;
  readonly slotId: SlotId | null;
  readonly order: number;
  readonly linkKind: "ownership" | "reference";
  readonly resolved: boolean;
  readonly ambiguous: boolean;
  readonly targetSourceNodeId: SourceNodeId | null;
  readonly resolution: ReferenceResolution | null;
  readonly overlay: PlacementOverlay;
  readonly provenance: Provenance;
}

export interface Slot {
  readonly contractVersion: 1;
  readonly id: SlotId;
  readonly ownerId: EntityId;
  readonly kind: "OptionSlot" | "Hardpoint" | "Generator" | "Attachment" | "Escort" | "Doctrine";
  readonly label: SafePresentation;
  readonly placementIds: readonly PlacementId[];
  readonly optionPlacementIds: readonly PlacementId[];
  readonly cardinality: SelectionCardinality;
  readonly costIds: readonly EntityId[];
  readonly constraintIds: readonly EntityId[];
  readonly conditionIds: readonly EntityId[];
  readonly modifierIds: readonly EntityId[];
  readonly hidden: boolean;
  readonly helper: boolean;
  readonly semantics: {
    readonly contractVersion: 1;
    readonly selection: "option";
    readonly evaluation: "deferred-to-kan-32";
    readonly profileRole?: "psa" | "fps-1" | "fps-2" | "fps-3" | null;
  };
  readonly provenance: Provenance;
}

export interface MigrationAlias {
  readonly contractVersion: 1;
  readonly alias: EntityId;
  readonly label: SafePresentation;
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
    readonly type?: string;
    readonly children?: readonly unknown[];
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
  readonly referencePolicy?: "fatal" | "report";
  readonly vocabulary?: DomainVocabulary;
}

export interface DomainVocabulary {
  readonly contractVersion: 1;
  readonly vocabularyVersion: string;
  readonly sourceCommit: string;
  readonly weaponProfileTypeIds: ReadonlySet<string>;
  readonly generatorIds: ReadonlySet<string>;
  readonly attachmentIds: ReadonlySet<string>;
  readonly escortIds: ReadonlySet<string>;
  readonly doctrineIds: ReadonlySet<string>;
  readonly profileSlotRoles?: Readonly<Record<string, "psa" | "fps-1" | "fps-2" | "fps-3">>;
}

export interface ContentHasher {
  sha256(value: string): Promise<string>;
}

export interface CatalogChunk {
  readonly id: string;
  readonly kind:
    | "entities"
    | "placements"
    | "slots"
    | "aliases"
    | "diagnostics"
    | "metadata"
    | "core"
    | "glossary"
    | "faction-index";
  readonly bucket?: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly value: string;
}

export interface CatalogIndex {
  readonly format: "dwb-domain-catalog";
  readonly manifestVersion: 1;
  readonly schemaVersion: typeof DOMAIN_SCHEMA_VERSION;
  readonly contentVersion: string;
  readonly sourceSchemaVersion: number;
  readonly sourceCommit: string;
  readonly chunks: readonly Omit<CatalogChunk, "value">[];
  readonly entityChunkById: Readonly<Record<string, string>>;
  readonly placementChunkById: Readonly<Record<string, string>>;
  readonly slotChunkById: Readonly<Record<string, string>>;
  readonly views: {
    readonly coreChunk: string;
    readonly glossaryChunk: string;
    readonly factionIndexChunks: Readonly<Record<string, string>>;
  };
}

export interface ChunkedDomainCatalog {
  readonly index: CatalogIndex;
  readonly chunks: Readonly<Record<string, string>>;
}

export interface DomainCatalogRepository {
  readonly contractVersion: 1;
  loadIndex(contentVersion: string): Promise<CatalogIndex>;
  loadChunk(sha256: string): Promise<string>;
}

export interface LosslessCatalogReader {
  readonly contractVersion: 1;
  read(): Promise<CatalogNormalizationInput>;
}

export interface DomainCatalogNormalizer {
  readonly contractVersion: 1;
  normalize(input: CatalogNormalizationInput, options?: NormalizationOptions): DomainCatalog;
}

export interface DomainCatalogWriter {
  readonly contractVersion: 1;
  writeChunk(sha256: string, value: string): Promise<void>;
  writeIndex(index: CatalogIndex): Promise<void>;
}
