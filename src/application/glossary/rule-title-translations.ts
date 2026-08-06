const russianRuleTitles: Readonly<Record<string, string>> = {
  "ablative armour": "Абляционная броня",
  aerial: "Воздушное оружие",
  airborne: "Воздушный",
  agile: "Манёвренный",
  alchemical: "Алхимический",
  "all around": "Круговой огонь",
  amphibious: "Амфибия",
  assault: "Штурмовое оружие",
  barrage: "Заградительный огонь",
  blast: "Взрыв",
  "boosted propulsion": "Усиленная тяга",
  breach: "Пробоина",
  corrosive: "Коррозионный",
  deadly: "Смертоносный",
  descend: "Снижение",
  devastating: "Разрушительный",
  guided: "Наводящийся",
  hazard: "Аварийный эффект",
  "high velocity": "Высокоскоростной",
  indirect: "Непрямой огонь",
  leaping: "Цепной разряд",
  magnetic: "Магнитный",
  piercing: "Бронебойный",
  precise: "Точный",
  rail: "Рельсовый",
  submerged: "Подводное оружие",
  torpedo: "Торпеда",
  torrent: "Шквал",
  tracer: "Трассирующий",
  voltaic: "Вольтаический",
};

export function translatedRuleTitle(title: string): string | null {
  return russianRuleTitles[normalizeRuleTitle(title)] ?? null;
}

export function localizedRuleDisplay(title: string, display: string): string {
  const translated = translatedRuleTitle(title);
  if (!translated) return display;
  const suffix = /\s*\([^)]*\)\s*$/u.exec(display)?.[0] ?? "";
  return `${translated}${suffix}`;
}

function normalizeRuleTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}
