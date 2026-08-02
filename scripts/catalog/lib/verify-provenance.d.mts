import type { SourceLock } from "./source-lock.mjs";

export interface LockedProvenance {
  readonly repository: string;
  readonly commit: string;
  readonly tree: string;
  readonly commitTimestamp: string;
  readonly files: readonly {
    readonly path: string;
    readonly blob: string;
    readonly bytes: number;
  }[];
}

export function verifyLockedProvenance(lock: SourceLock): Promise<LockedProvenance>;
