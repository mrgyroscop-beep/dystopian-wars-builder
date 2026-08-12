import manifest from "../assets/ship-image-manifest.json";

type ShipImageEntry = { readonly imageIndex: number; readonly url: string };

const images = manifest.images as Record<string, Record<string, ShipImageEntry> | undefined>;

export function shipImageFor(faction: string, shipName: string): string | null {
  return images[compact(faction)]?.[compact(shipName)]?.url ?? null;
}

function compact(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, "");
}
