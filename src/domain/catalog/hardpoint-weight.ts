export type HardpointWeight = "heavy" | "light";

export function hardpointWeightFromLabel(value: string): HardpointWeight | null {
  const normalized = value.trim().toLocaleLowerCase("en");
  if (/(?:^|[^a-z])heavy(?:$|[^a-z])/u.test(normalized)) return "heavy";
  if (/(?:^|[^a-z])light(?:$|[^a-z])/u.test(normalized)) return "light";
  return null;
}
