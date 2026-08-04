import manifest from "../assets/orbat-card-manifest.json";

const factionSlugs: Readonly<Record<string, string>> = {
  alliance: "alliance",
  commonwealth: "commonwealth",
  crown: "crown",
  empire: "empire",
  enlightened: "enlightened",
  imperium: "imperium",
  sultanate: "sultanate",
  union: "union",
};

export function orbatCardFor(faction: string, shipName: string): string | null {
  const slug = factionSlugs[compact(faction)];
  if (!slug) return null;
  const cards = manifest.cards as Record<string, Record<string, string> | undefined>;
  return cards[slug]?.[compact(shipName)] ?? null;
}

function compact(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, "");
}
