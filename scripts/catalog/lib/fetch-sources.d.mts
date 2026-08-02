import type { SourceLock, SourceLockFile } from "./source-lock.mjs";

export interface LockedSource extends SourceLockFile {
  readonly file: string;
  readonly cache: "hit" | "miss";
}

export function fetchLockedSources(
  lock: SourceLock,
  cacheRoot: string,
): Promise<readonly LockedSource[]>;
