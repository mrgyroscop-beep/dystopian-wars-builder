import manifest from "../assets/module-lore-manifest.json";
import russianParagraphs from "../assets/module-lore.ru.json";

export type ModuleLore = (typeof manifest.modules)[number];
export const moduleLoreSource = manifest.source;
const russianLore: Readonly<Record<string, readonly string[] | undefined>> = russianParagraphs;

export function moduleLoreRussianParagraphs(module: ModuleLore): readonly string[] | null {
  return russianLore[module.id] ?? null;
}

function key(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/^focused\s+/u, "")
    .replace(/[^a-z0-9]+/gu, "");
}

const empireModules = new Map(
  manifest.modules.flatMap((module) =>
    [module.name, ...module.aliases].map((name) => [key(name), module] as const),
  ),
);

export function moduleLoreFor(faction: string, name: string): ModuleLore | null {
  if (key(faction) !== key(manifest.faction)) return null;
  return empireModules.get(key(name)) ?? null;
}
