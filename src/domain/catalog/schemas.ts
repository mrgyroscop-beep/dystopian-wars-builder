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
  .object({ type: z.enum(["text", "strong", "lineBreak"]), value: z.string().optional() })
  .strict();
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
const presentation = z
  .object({
    plainText: z.string(),
    blocks: z.array(z.union([paragraph, table])),
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
    identityQuality: z.enum(["stable", "duplicate", "synthetic"]),
    label: presentation,
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
  entityBase.extend({ kind: z.literal("Cost"), amount: costAmount }),
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
          semantics: z
            .object({
              contractVersion,
              selection: z.literal("option"),
              evaluation: z.literal("deferred-to-kan-32"),
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
