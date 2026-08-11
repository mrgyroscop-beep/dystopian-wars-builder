const images: Readonly<Record<string, string>> = {
  bunya: "/campaign/ships/bunya-automata.webp",
  buredo: "/campaign/ships/the-buredo.webp",
  "chaudharys-revenge": "/campaign/ships/chaudharys-revenge.webp",
  crows: "/campaign/ships/the-crows.webp",
  "diyu-huo": "/campaign/ships/diyu-huo.webp",
  kamarupa: "/campaign/ships/kamarupa-squadron.webp",
  nagato: "/campaign/ships/the-nagato.webp",
  pembroke: "/campaign/ships/hms-pembroke.webp",
  sentosa: "/campaign/ships/the-sentosa.webp",
  shinsei: "/campaign/ships/the-shinsei.webp",
  skua: "/campaign/ships/skua-squadron.webp",
  ssang: "/campaign/ships/ssang.webp",
  strikakulam: "/campaign/ships/hmis-strikakulam.webp",
  "taiyo-furea": "/campaign/ships/taiyo-furea.webp",
  tulwar: "/campaign/ships/patrol-group-tulwar.webp",
};

export function campaignShipImage(profileId: string): string | null {
  return images[profileId] ?? null;
}
