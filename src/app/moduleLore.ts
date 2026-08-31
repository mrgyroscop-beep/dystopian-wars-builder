import empire from "../assets/module-lore-manifest.json";
import empireRu from "../assets/module-lore.ru.json";
import alliance from "../assets/module-lore/alliance.json";
import allianceRu from "../assets/module-lore/alliance.ru.json";
import commonwealth from "../assets/module-lore/commonwealth.json";
import crown from "../assets/module-lore/crown.json";
import crownRu from "../assets/module-lore/crown.ru.json";
import enlightened from "../assets/module-lore/enlightened.json";
import enlightenedRu from "../assets/module-lore/enlightened.ru.json";
import imperium from "../assets/module-lore/imperium.json";
import sultanate from "../assets/module-lore/sultanate.json";
import sultanateRu from "../assets/module-lore/sultanate.ru.json";
import union from "../assets/module-lore/union.json";

interface ModuleSource {
  readonly title: string;
  readonly url: string;
  readonly kind?: string;
}

interface ModuleRecord {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly category: string;
  readonly page: number;
  readonly imageUrl: string | null;
  readonly imageWidth: number | null;
  readonly imageHeight: number | null;
  readonly paragraphs: readonly string[];
  readonly source?: ModuleSource;
}

interface ModulePack {
  readonly faction: string;
  readonly source: ModuleSource;
  readonly modules: readonly ModuleRecord[];
}

export interface ModuleLore extends ModuleRecord {
  readonly faction: string;
  readonly arsenal: string;
  readonly source: ModuleSource;
  readonly russianParagraphs: readonly string[] | null;
}

export function moduleLoreRussianParagraphs(module: ModuleLore): readonly string[] | null {
  return module.russianParagraphs;
}

function key(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/^(?:focused|focussed|sharpshooter|extreme range)\s+/u, "")
    .replace(/\s*\(\d+\)\s*$/u, "")
    .replace(/[^a-z0-9]+/gu, "");
}

type Translation = Readonly<Record<string, readonly string[] | undefined>>;

function index(pack: ModulePack, arsenal: string, translation: Translation = {}) {
  return new Map(
    pack.modules.flatMap((record) => {
      const module: ModuleLore = {
        ...record,
        faction: pack.faction,
        arsenal,
        source: record.source ?? pack.source,
        russianParagraphs: translation[record.id] ?? null,
      };
      return [record.name, ...record.aliases].map((name) => [key(name), module] as const);
    }),
  );
}

// Shared names must never mix another faction's illustration or history into a card.
const factions = new Map([
  ["empire", index(empire, "Империи", empireRu)],
  ["alliance", index(alliance, "Альянса", allianceRu)],
  ["commonwealth", index(commonwealth, "Содружества")],
  ["crown", index(crown, "Короны", crownRu)],
  ["enlightened", index(enlightened, "Просвещённых", enlightenedRu)],
  ["imperium", index(imperium, "Империума")],
  ["sultanate", index(sultanate, "Султаната", sultanateRu)],
  ["union", index(union, "Союза")],
]);

export function moduleLoreFor(faction: string, name: string): ModuleLore | null {
  return factions.get(key(faction))?.get(key(name)) ?? null;
}
