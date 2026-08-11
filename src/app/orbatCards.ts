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

const fixtureAliases: Readonly<Record<string, Record<string, string> | undefined>> = {
  empire: {
    akitademonstrator: "/orbat-cards/empire/23.webp",
  },
};

export function orbatCardFor(faction: string, shipName: string): string | null {
  const slug = factionSlugs[compact(faction)];
  if (!slug) return null;
  const cards = manifest.cards as Record<string, Record<string, string> | undefined>;
  const key = compact(shipName);
  return cards[slug]?.[key] ?? fixtureAliases[slug]?.[key] ?? null;
}

function compact(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, "");
}
