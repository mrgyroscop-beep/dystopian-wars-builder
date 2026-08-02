import type { EntityId, PlacementId, SlotId } from "../catalog";
import { z } from "zod";

import type { Brand } from "../catalog";

export type RosterInstanceId = Brand<string, "RosterInstanceId">;

export interface RosterSelectionInstance {
  readonly contractVersion: 1;
  readonly id: RosterInstanceId;
  readonly definitionId: EntityId;
  readonly placementId: PlacementId | null;
  readonly slotId: SlotId | null;
  readonly parentInstanceId: RosterInstanceId | null;
  readonly forceInstanceId: RosterInstanceId | null;
  readonly quantity: number;
}

export interface RosterSnapshot {
  readonly contractVersion: 1;
  readonly id: string;
  readonly catalogContentVersion: string;
  readonly rootInstanceIds: readonly RosterInstanceId[];
  readonly instances: Readonly<Record<string, RosterSelectionInstance>>;
}

const nullableStableIdSchema = z.string().min(1).max(240).nullable();

export const rosterSelectionInstanceSchema = z
  .object({
    contractVersion: z.literal(1),
    id: z.string().min(1).max(240),
    definitionId: z.string().min(1).max(240),
    placementId: nullableStableIdSchema,
    slotId: nullableStableIdSchema,
    parentInstanceId: nullableStableIdSchema,
    forceInstanceId: nullableStableIdSchema,
    quantity: z.number().int().min(1).max(10_000),
  })
  .strict();

export const rosterSnapshotSchema = z
  .object({
    contractVersion: z.literal(1),
    id: z.string().min(1).max(80),
    catalogContentVersion: z.string().min(1).max(240),
    rootInstanceIds: z.array(z.string().min(1).max(240)),
    instances: z.record(z.string().min(1).max(240), rosterSelectionInstanceSchema),
  })
  .strict()
  .superRefine((snapshot, context) => {
    for (const [key, instance] of Object.entries(snapshot.instances)) {
      if (key !== instance.id)
        context.addIssue({
          code: "custom",
          message: "Roster instance record key must equal instance.id",
          path: ["instances", key, "id"],
        });
    }
  });

export type EvaluationStatus = "valid" | "invalid" | "indeterminate";
export type ProblemSeverity = "error" | "warning" | "indeterminate";

export interface ProblemTarget {
  readonly instanceId: RosterInstanceId | null;
  readonly entityId: EntityId | null;
  readonly placementId: PlacementId | null;
  readonly slotId: SlotId | null;
}

export interface RosterProblem {
  readonly id: string;
  readonly code: string;
  readonly severity: ProblemSeverity;
  readonly message: string;
  readonly target: ProblemTarget;
  readonly sourceEntityId: EntityId | null;
  readonly actual: string | null;
  readonly expected: string | null;
}

export interface CostContribution {
  readonly instanceId: RosterInstanceId;
  readonly costId: EntityId;
  readonly origin: "definition" | "placement";
  readonly resource: "points" | "victory-points" | "other" | "unknown";
  readonly costTypeId: EntityId | null;
  readonly sourceCostTypeId: string | null;
  readonly role: "base" | "delta";
  readonly quantity: number;
  readonly unitValue: string;
  readonly value: string;
}

export interface CostTotal {
  readonly key: string;
  readonly resource: "points" | "victory-points" | "other" | "unknown";
  readonly costTypeId: EntityId | null;
  readonly sourceCostTypeId: string | null;
  readonly value: string;
  readonly complete: boolean;
}

export interface EffectiveSlotCardinality {
  readonly ownerInstanceId: RosterInstanceId;
  readonly slotId: SlotId;
  readonly selected: number;
  readonly minimum: string | null;
  readonly maximum: string | null;
  readonly status: "satisfied" | "underfilled" | "overfilled" | "indeterminate";
  readonly visibility: "visible" | "hidden" | "indeterminate";
  readonly helper: boolean;
}

export interface PlacementAvailability {
  readonly ownerInstanceId: RosterInstanceId;
  readonly placementId: PlacementId;
  readonly state: "available" | "unavailable" | "indeterminate";
  readonly reasonCodes: readonly string[];
}

export interface RosterEvaluation {
  readonly contractVersion: 1;
  readonly rosterId: string;
  readonly catalogContentVersion: string;
  readonly status: EvaluationStatus;
  readonly valid: boolean;
  readonly totals: readonly CostTotal[];
  readonly contributions: readonly CostContribution[];
  readonly slots: readonly EffectiveSlotCardinality[];
  readonly availability: readonly PlacementAvailability[];
  readonly problems: readonly RosterProblem[];
}
