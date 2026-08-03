import { z } from "zod";
import { DOMAIN_SCHEMA_VERSION, entityKinds } from "./types";

const contractVersion = z.literal(1);
const brandedId = z.string().regex(/^dw4:[^:]+:[^:]+:[^:]+/u);
const sourcePin = z
  .object({
    repository: z.string().min(1),
    commit: z.string().regex(/^[0-9a-f]{40}$/u),
    tree: z.string().regex(/^[0-9a-f]{40}$/u),
    commitTimestamp: z.iso.datetime({ offset: true }),
  })
  .strict();
const inline = z
  .object({
    type: z.enum(["text", "strong", "emphasis", "lineBreak", "reference"]),
    value: z.string().optional(),
    reference: z
      .object({ state: z.enum(["resolved", "unresolved"]), target: z.string() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.type === "reference" && !value.reference)
      context.addIssue({ code: "custom", message: "Reference metadata is required" });
    if (value.type !== "reference" && value.reference)
      context.addIssue({ code: "custom", message: "Reference metadata is not allowed" });
  });
const paragraph = z.object({ type: z.literal("paragraph"), children: z.array(inline) }).strict();
const table = z
  .object({
    type: z.literal("table"),
    rows: z.array(
      z
        .object({
          type: z.literal("tableRow"),
          cells: z.array(
            z
              .object({
                type: z.literal("tableCell"),
                header: z.boolean(),
                children: z.array(inline),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
const list = z
  .object({
    type: z.literal("list"),
    ordered: z.boolean(),
    items: z.array(z.object({ type: z.literal("listItem"), children: z.array(inline) }).strict()),
  })
  .strict();
const presentation = z
  .object({
    plainText: z.string(),
    blocks: z.array(z.union([paragraph, table, list])),
    contentUnavailable: z.boolean(),
    diagnostics: z.array(z.string()),
  })
  .strict();
const provenance = z
  .object({
    source: sourcePin,
    documentPath: z.string().min(1),
    documentBlob: z.string().regex(/^[0-9a-f]{40}$/u),
    documentSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    documentRootId: z.string().min(1),
    sourceNodeId: brandedId,
    sourceTag: z.string().min(1),
    upstreamId: z.string().nullable(),
    occurrence: z.number().int().positive(),
    xmlPath: z.string().min(1),
    resolutionChain: z.array(brandedId),
    sourceRevision: z.string().min(1),
    importRevision: z.number().int().positive(),
    schemaRevision: z.literal(DOMAIN_SCHEMA_VERSION),
  })
  .strict();
const labels = z
  .object({
    contractVersion,
    canonicalLabel: z.string().min(1),
    sourceLabel: z.string().nullable(),
    aliases: z.array(z.string()),
    locale: z.literal("und"),
    fallbackLabel: z.string().min(1),
  })
  .strict();
const identity = z
  .object({
    contractVersion,
    canonicalId: brandedId,
    sourceNodeId: brandedId,
    upstreamId: z.string().nullable(),
    occurrence: z.number().int().positive(),
    quality: z.enum(["upstream", "scoped", "synthetic"]),
    migrationAliasIds: z.array(brandedId),
  })
  .strict();
const costAmount = z.discriminatedUnion("state", [
  z.object({ contractVersion, state: z.literal("missing") }).strict(),
  z.object({ contractVersion, state: z.literal("unknown"), raw: z.string() }).strict(),
  z.object({ contractVersion, state: z.literal("not-applicable"), raw: z.string() }).strict(),
  z.object({ contractVersion, state: z.literal("zero"), value: z.literal("0") }).strict(),
  z
    .object({
      contractVersion,
      state: z.literal("value"),
      value: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u),
    })
    .strict(),
]);
const resolution = z.discriminatedUnion("state", [
  z
    .object({
      contractVersion,
      state: z.literal("resolved"),
      upstreamId: z.string(),
      entityId: brandedId,
      sourceNodeId: brandedId,
      chain: z.array(brandedId),
    })
    .strict(),
  z
    .object({
      contractVersion,
      state: z.literal("unresolved"),
      upstreamId: z.string(),
      chain: z.array(brandedId),
    })
    .strict(),
  z
    .object({
      contractVersion,
      state: z.literal("ambiguous"),
      upstreamId: z.string(),
      candidateEntityIds: z.array(brandedId),
      chain: z.array(brandedId),
    })
    .strict(),
]);
const expression = z
  .object({
    contractVersion,
    operator: z.string().nullable(),
    field: z.string().nullable(),
    scope: z.string().nullable(),
    value: z.string().nullable(),
    references: z.array(brandedId),
    referenceResolutions: z.array(resolution),
    flags: z.record(z.string(), z.string()),
    evaluable: z.boolean(),
    unevaluableReasons: z.array(z.string()),
  })
  .strict();
const extension: z.ZodType = z.lazy(() =>
  z
    .object({
      contractVersion,
      sourceTag: z.string().min(1),
      order: z.number().int().nonnegative(),
      attributes: z.record(z.string(), z.string()),
      value: presentation,
      children: z.array(extension),
      provenance,
    })
    .strict(),
);
const field = z
  .object({
    contractVersion,
    sourceTag: z.string().min(1),
    order: z.number().int().nonnegative(),
    label: presentation,
    value: presentation,
    attributes: z.record(z.string(), z.string()),
    provenance,
  })
  .strict();
const entityBase = z
  .object({
    contractVersion,
    id: brandedId,
    kind: z.enum(entityKinds),
    sourceTag: z.string().min(1),
    identityQuality: z.enum(["upstream", "scoped", "synthetic"]),
    identity,
    label: presentation,
    labels,
    description: presentation.optional(),
    attributes: z.record(z.string(), z.string()),
    fields: z.array(field),
    extensions: z.array(extension),
    categoryIds: z.array(brandedId),
    costIds: z.array(brandedId),
    constraintIds: z.array(brandedId),
    conditionIds: z.array(brandedId),
    modifierIds: z.array(brandedId),
    repeatIds: z.array(brandedId),
    profileIds: z.array(brandedId),
    ruleIds: z.array(brandedId),
    slotIds: z.array(z.string()),
    provenance,
  })
  .strict();

const plainEntity = <
  Kind extends Exclude<
    (typeof entityKinds)[number],
    "Cost" | "Constraint" | "ConditionGroup" | "Condition" | "Modifier" | "Repeat"
  >,
>(
  kind: Kind,
) => entityBase.extend({ kind: z.literal(kind) });
const expressionEntity = <
  Kind extends "Constraint" | "ConditionGroup" | "Condition" | "Modifier" | "Repeat",
>(
  kind: Kind,
) => entityBase.extend({ kind: z.literal(kind), expression });

export const domainEntitySchema = z.discriminatedUnion("kind", [
  plainEntity("GameSystem"),
  plainEntity("Faction"),
  plainEntity("Battlefleet"),
  plainEntity("BattlefleetElement"),
  plainEntity("Category"),
  plainEntity("Unit"),
  plainEntity("Model"),
  plainEntity("Profile"),
  plainEntity("Weapon"),
  plainEntity("OptionSlot"),
  plainEntity("Option"),
  plainEntity("Hardpoint"),
  plainEntity("Generator"),
  plainEntity("Attachment"),
  plainEntity("Escort"),
  plainEntity("Doctrine"),
  plainEntity("Rule"),
  plainEntity("CostType"),
  entityBase.extend({
    kind: z.literal("Cost"),
    amount: costAmount,
    semantics: z
      .object({
        contractVersion,
        amount: costAmount,
        costTypeId: brandedId.nullable(),
        sourceCostTypeId: z.string().nullable(),
        resource: z.enum(["points", "victory-points", "other", "unknown"]),
        role: z.enum(["base", "delta", "limit", "unknown"]),
        scope: z.string().nullable(),
      })
      .strict(),
  }),
  expressionEntity("Constraint"),
  expressionEntity("ConditionGroup"),
  expressionEntity("Condition"),
  expressionEntity("Modifier"),
  expressionEntity("Repeat"),
]);

export const placementSchema = z
  .object({
    contractVersion,
    id: z.string().min(1),
    ownerId: brandedId,
    definitionId: brandedId.nullable(),
    slotId: z.string().nullable(),
    order: z.number().int().nonnegative(),
    linkKind: z.enum(["ownership", "reference"]),
    resolved: z.boolean(),
    ambiguous: z.boolean(),
    targetSourceNodeId: brandedId.nullable(),
    resolution: resolution.nullable(),
    overlay: z
      .object({
        categoryIds: z.array(brandedId),
        costIds: z.array(brandedId),
        constraintIds: z.array(brandedId),
        conditionIds: z.array(brandedId),
        modifierIds: z.array(brandedId),
        repeatIds: z.array(brandedId),
        attributes: z.record(z.string(), z.string()),
        cardinality: z
          .object({
            contractVersion,
            minimum: costAmount,
            maximum: costAmount,
            effective: z.literal("deferred-to-kan-32"),
          })
          .strict()
          .optional(),
      })
      .strict(),
    provenance,
  })
  .strict();

export const domainCatalogSchema = z
  .object({
    schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
    contentVersion: z.string().min(1),
    source: sourcePin,
    entities: z.record(z.string(), domainEntitySchema),
    placements: z.record(z.string(), placementSchema),
    slots: z.record(
      z.string(),
      z
        .object({
          contractVersion,
          id: z.string(),
          ownerId: brandedId,
          kind: z.enum([
            "OptionSlot",
            "Hardpoint",
            "Generator",
            "Attachment",
            "Escort",
            "Doctrine",
          ]),
          label: presentation,
          placementIds: z.array(z.string()),
          optionPlacementIds: z.array(z.string()),
          cardinality: z
            .object({
              contractVersion,
              minimum: costAmount,
              maximum: costAmount,
              effective: z.literal("deferred-to-kan-32"),
            })
            .strict(),
          costIds: z.array(brandedId),
          constraintIds: z.array(brandedId),
          conditionIds: z.array(brandedId),
          modifierIds: z.array(brandedId),
          hidden: z.boolean(),
          helper: z.boolean(),
          semantics: z
            .object({
              contractVersion,
              selection: z.literal("option"),
              evaluation: z.literal("deferred-to-kan-32"),
              profileRole: z.enum(["psa", "fps-1", "fps-2", "fps-3"]).nullable().optional(),
            })
            .strict(),
          provenance,
        })
        .strict(),
    ),
    aliases: z.record(
      z.string(),
      z
        .object({
          contractVersion,
          alias: brandedId,
          label: presentation,
          entityIds: z.array(brandedId).min(1),
          ambiguous: z.boolean(),
          provenance,
          explicit: z.literal(true),
        })
        .strict(),
    ),
    roots: z.array(brandedId),
    diagnostics: z.array(
      z
        .object({
          code: z.string(),
          severity: z.enum(["warning", "fatal"]),
          sourceNodeId: brandedId.optional(),
          detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        })
        .strict(),
    ),
  })
  .strict();

const chunkKind = z.enum([
  "entities",
  "placements",
  "slots",
  "aliases",
  "diagnostics",
  "metadata",
  "core",
  "glossary",
  "faction-index",
]);
const recordEntries = z.array(z.tuple([z.string().min(1), z.unknown()]));

export const catalogChunkPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("metadata"),
      schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
      source: sourcePin,
      roots: z.array(brandedId),
    })
    .strict(),
  z
    .object({
      kind: z.literal("entities"),
      bucket: z.string().regex(/^(?:[0-9a-f]{2})+$/u),
      entries: recordEntries,
    })
    .strict(),
  ...(["placements", "slots", "aliases", "diagnostics"] as const).map((kind) =>
    z.object({ kind: z.literal(kind), entries: recordEntries }).strict(),
  ),
  z
    .object({ kind: z.literal("core"), roots: z.array(brandedId), entityIds: z.array(brandedId) })
    .strict(),
  z.object({ kind: z.literal("glossary"), entityIds: z.array(brandedId) }).strict(),
  z
    .object({
      kind: z.literal("faction-index"),
      factionId: brandedId,
      entityIds: z.array(brandedId),
    })
    .strict(),
]);

export const catalogIndexSchema = z
  .object({
    format: z.literal("dwb-domain-catalog"),
    manifestVersion: z.literal(1),
    schemaVersion: z.literal(DOMAIN_SCHEMA_VERSION),
    contentVersion: z.string().regex(/^[0-9a-f]{64}$/u),
    sourceSchemaVersion: z.number().int().positive(),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/u),
    chunks: z.array(
      z
        .object({
          id: z.string().min(1),
          kind: chunkKind,
          bucket: z
            .string()
            .regex(/^(?:[0-9a-f]{2})+$/u)
            .optional(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/u),
          bytes: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    entityChunkById: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/u)),
    placementChunkById: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/u)),
    slotChunkById: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/u)),
    views: z
      .object({
        coreChunk: z.string().regex(/^[0-9a-f]{64}$/u),
        glossaryChunk: z.string().regex(/^[0-9a-f]{64}$/u),
        factionIndexChunks: z.record(z.string(), z.string().regex(/^[0-9a-f]{64}$/u)),
      })
      .strict(),
  })
  .strict();
