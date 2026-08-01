export interface SourceLockFile {
  readonly path: string;
  readonly blob: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface SourceLock {
  readonly repository: string;
  readonly commit: string;
  readonly tree: string;
  readonly commitTimestamp: string;
  readonly files: readonly SourceLockFile[];
}

export function readSourceLock(file: string): Promise<SourceLock>;
