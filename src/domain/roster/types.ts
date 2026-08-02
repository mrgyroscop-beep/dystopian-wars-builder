import type { EntityId, PlacementId, SlotId } from "../catalog";

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
