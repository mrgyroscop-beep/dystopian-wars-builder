import type { RosterLibraryRepository } from "./roster-library";

export interface RosterSyncResult {
  readonly authenticated: boolean;
  readonly downloaded: number;
  readonly uploaded: number;
  readonly conflicts: number;
}

export interface RosterSyncGateway extends RosterLibraryRepository {
  syncNow(): Promise<RosterSyncResult>;
}
