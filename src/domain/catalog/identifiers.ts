import type { EntityId, PlacementId, SlotId, SourceNodeId } from "./types";

const unsafe = /[^A-Za-z0-9._-]+/gu;

export function sourceNodeId(
  rootId: string,
  tag: string,
  upstreamId: string,
  occurrence = 1,
): SourceNodeId {
  const base = `dw4:${segment(rootId)}:${segment(tag)}:${segment(upstreamId)}`;
  return `${base}${occurrence > 1 ? `~${occurrence}` : ""}` as SourceNodeId;
}

export function entityId(id: SourceNodeId): EntityId {
  return id as string as EntityId;
}

export function placementId(
  owner: EntityId,
  source: SourceNodeId,
  order: number,
  relation: "ownership" | "reference" = "ownership",
): PlacementId {
  return `${owner}:placement:${relation}:${source}:${order}` as PlacementId;
}

export function slotId(id: EntityId): SlotId {
  return `${id}:slot` as SlotId;
}

export function parseOccurrence(nodeKey: string): number {
  if (/:path:\d+$/u.test(nodeKey)) return 1;
  const value = /:(\d+)$/u.exec(nodeKey)?.[1];
  return value ? Number.parseInt(value, 10) : 1;
}

export function upstreamIdFromKey(nodeKey: string, explicitId?: string): string {
  if (explicitId) return explicitId;
  const path = /:path:(\d+)$/u.exec(nodeKey)?.[1];
  return path ? `path-${path}` : nodeKey;
}

function segment(value: string): string {
  const normalized = value
    .normalize("NFC")
    .trim()
    .replace(unsafe, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || "missing";
}
