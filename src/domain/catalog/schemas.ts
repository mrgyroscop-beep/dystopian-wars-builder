import { z } from "zod";
import { DOMAIN_SCHEMA_VERSION, entityKinds } from "./types";

const brandedId = z.string().regex(/^dw4:[^:]+:[^:]+:[^:]+/u);
const sourcePin = z
  .object({
    repository: z.string().min(1),
    commit: z.string().regex(/^[0-9a-f]{40}$/u),
    tree: z.string().regex(/^[0-9a-f]{40}$/u),
    commitTimestamp: z.iso.datetime({ offset: true }),
  })
  .strict();
const presentation = z
  .object({
    plainText: z.string(),
    blocks: z.array(
      z
        .object({
          type: z.literal("paragraph"),
          children: z.array(
            z
              .object({
                type: z.enum(["text", "strong", "lineBreak"]),
                value: z.string().optional(),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
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
  z.object({ state: z.literal("missing") }).strict(),
  z.object({ state: z.literal("unknown"), raw: z.string() }).strict(),
  z.object({ state: z.literal("not-applicable"), raw: z.string() }).strict(),
  z.object({ state: z.literal("zero"), value: z.literal("0") }).strict(),
  z
    .object({ state: z.literal("value"), value: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u) })
    .strict(),
]);
const expression = z
  .object({
    operator: z.string().nullable(),
    field: z.string().nullable(),
    scope: z.string().nullable(),
    value: z.string().nullable(),
    references: z.array(brandedId),
    flags: z.record(z.string(), z.string()),
    evaluable: z.boolean(),
    unevaluableReasons: z.array(z.string()),
  })
  .strict();

export const domainEntitySchema = z
  .object({
    id: brandedId,
    kind: z.enum(entityKinds),
    sourceTag: z.string().min(1),
    identityQuality: z.enum(["stable", "duplicate", "synthetic"]),
    label: presentation,
    description: presentation.optional(),
    attributes: z.record(z.string(), z.string()),
    fields: z.array(
      z
        .object({
          sourceTag: z.string().min(1),
          order: z.number().int().nonnegative(),
          label: presentation,
          value: presentation,
          attributes: z.record(z.string(), z.string()),
          provenance,
        })
        .strict(),
    ),
    categoryIds: z.array(brandedId),
    costIds: z.array(brandedId),
    constraintIds: z.array(brandedId),
    conditionIds: z.array(brandedId),
    modifierIds: z.array(brandedId),
    repeatIds: z.array(brandedId),
    profileIds: z.array(brandedId),
    ruleIds: z.array(brandedId),
    slotIds: z.array(z.string()),
    amount: costAmount.optional(),
    expression: expression.optional(),
    provenance,
  })
  .strict();

export const placementSchema = z
  .object({
    id: z.string().min(1),
    ownerId: brandedId,
    definitionId: brandedId.nullable(),
    slotId: z.string().nullable(),
    order: z.number().int().nonnegative(),
    linkKind: z.enum(["ownership", "reference"]),
    resolved: z.boolean(),
    ambiguous: z.boolean(),
    targetSourceNodeId: brandedId.nullable(),
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
          provenance,
        })
        .strict(),
    ),
    aliases: z.record(
      z.string(),
      z
        .object({
          alias: brandedId,
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
