export function compareCatalogVersions(candidate, active) {
  if (
    typeof candidate?.releaseId === "string" &&
    candidate.releaseId.length > 0 &&
    candidate.releaseId === active?.releaseId
  )
    return "EQUAL";

  const candidateInventory = indexInventory(candidate?.manifest?.inventory);
  const activeInventory = indexInventory(active?.manifest?.inventory);
  if (!candidateInventory || !activeInventory || candidateInventory.size !== activeInventory.size)
    return "UNKNOWN";

  let greater = false;
  let less = false;
  for (const [path, candidateItem] of candidateInventory) {
    const activeItem = activeInventory.get(path);
    if (!activeItem || candidateItem.kind !== activeItem.kind || candidateItem.id !== activeItem.id)
      return "UNKNOWN";
    if (candidateItem.revision > activeItem.revision) greater = true;
    if (candidateItem.revision < activeItem.revision) less = true;
  }
  if (greater && less) return "INCOMPARABLE";
  if (greater) return "NEWER";
  if (less) return "OLDER";

  const candidateTimestamp = canonicalTimestamp(
    candidate?.manifest?.source?.resolved?.commitTimestamp,
  );
  const activeTimestamp = canonicalTimestamp(active?.manifest?.source?.resolved?.commitTimestamp);
  if (candidateTimestamp === undefined || activeTimestamp === undefined) return "UNKNOWN";
  if (candidateTimestamp > activeTimestamp) return "NEWER";
  if (candidateTimestamp < activeTimestamp) return "OLDER";
  return "EQUAL";
}

function indexInventory(inventory) {
  if (!Array.isArray(inventory) || inventory.length === 0) return undefined;
  const indexed = new Map();
  for (const item of inventory) {
    if (
      !isCanonicalPath(item?.path) ||
      indexed.has(item.path) ||
      typeof item.kind !== "string" ||
      item.kind.length === 0 ||
      typeof item.id !== "string" ||
      item.id.length === 0 ||
      typeof item.revision !== "string" ||
      !/^\d+$/u.test(item.revision)
    )
      return undefined;
    indexed.set(item.path, { kind: item.kind, id: item.id, revision: BigInt(item.revision) });
  }
  return indexed;
}

function isCanonicalPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value !== value.normalize("NFC") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.endsWith("/")
  )
    return false;
  return value
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

function canonicalTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(value))
    return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  return new Date(milliseconds).toISOString().replace(".000Z", "Z") === value
    ? milliseconds
    : undefined;
}
