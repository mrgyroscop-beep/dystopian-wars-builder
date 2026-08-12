import { z } from "zod";

import { storedRosterSchema } from "../rosters/create-roster";

export const criticalEffectIds = [
  "breach",
  "structural-failure",
  "hazard",
  "shredded-defences",
  "navigation-lock",
  "system-failure",
] as const;

export type CriticalEffectId = (typeof criticalEffectIds)[number];
export type BattleSide = "host" | "guest";

export const roomKeySchema = z.tuple([
  z.enum(criticalEffectIds),
  z.enum(criticalEffectIds),
  z.enum(criticalEffectIds),
]);

export const shipBattleStateSchema = z
  .object({
    damage: z.number().int().min(0).max(99).default(0),
    disorder: z.number().int().min(0).max(3).default(0),
    criticals: z
      .partialRecord(z.enum(criticalEffectIds), z.number().int().min(0).max(20))
      .default({}),
    crippled: z.boolean().default(false),
    destroyed: z.boolean().default(false),
    withdrawn: z.boolean().default(false),
    activated: z.boolean().default(false),
  })
  .strict();

export const battlePlayerSchema = z.object({
  displayName: z.string().min(1).max(80),
  roster: storedRosterSchema,
  ready: z.boolean(),
  shipState: z.record(z.string(), shipBattleStateSchema),
});

export const battleRoomSchema = z.object({
  key: roomKeySchema,
  you: z.enum(["host", "guest"]),
  status: z.enum(["waiting", "preparing", "active", "finished"]),
  version: z.number().int().positive(),
  round: z.number().int().min(1).max(20),
  activeSide: z.enum(["host", "guest"]),
  expiresAt: z.string().datetime(),
  host: battlePlayerSchema,
  guest: battlePlayerSchema.nullable(),
});

export type RoomKey = z.infer<typeof roomKeySchema>;
export type ShipBattleState = z.infer<typeof shipBattleStateSchema>;
export type BattlePlayer = z.infer<typeof battlePlayerSchema>;
export type BattleRoom = z.infer<typeof battleRoomSchema>;

export type BattleUpdate =
  | { readonly type: "ready"; readonly ready: boolean }
  | { readonly type: "round"; readonly round: number; readonly activeSide: BattleSide }
  | {
      readonly type: "ship";
      readonly shipId: string;
      readonly state: ShipBattleState;
    };

export interface BattleGateway {
  readonly contractVersion: 1;
  create(rosterId: string): Promise<BattleRoom>;
  join(key: RoomKey, rosterId: string): Promise<BattleRoom>;
  read(key: RoomKey, signal?: AbortSignal): Promise<BattleRoom>;
  update(key: RoomKey, expectedVersion: number, update: BattleUpdate): Promise<BattleRoom>;
  leave(key: RoomKey): Promise<void>;
}
