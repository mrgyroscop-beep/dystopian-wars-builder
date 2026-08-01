import type { LockedSource } from "./fetch-sources.mjs";
import type { SourceLock } from "./source-lock.mjs";
import type { LockedProvenance } from "./verify-provenance.mjs";

export interface BuiltDataset {
  readonly releaseId: string;
  readonly files: ReadonlyMap<string, string>;
  readonly manifest: {
    readonly source: {
      readonly resolved: {
        readonly repository: string;
        readonly commit: string;
        readonly tree: string;
        readonly commitTimestamp: string;
      };
    };
  };
}

export function buildDataset(
  lock: SourceLock,
  sources: readonly LockedSource[],
  provenance: LockedProvenance,
): Promise<BuiltDataset>;
