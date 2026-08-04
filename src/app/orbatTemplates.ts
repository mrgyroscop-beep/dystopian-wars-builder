export interface OrbatTemplate {
  readonly accent: string;
  readonly imageUrl: string;
}

const templates: Readonly<Record<string, OrbatTemplate>> = {
  alliance: { accent: "#cc6807", imageUrl: "/orbat-templates/alliance.webp" },
  commonwealth: { accent: "#5e351d", imageUrl: "/orbat-templates/commonwealth.webp" },
  crown: { accent: "#162a35", imageUrl: "/orbat-templates/crown.webp" },
  empire: { accent: "#a70d12", imageUrl: "/orbat-templates/empire.webp" },
  enlightened: { accent: "#a56c08", imageUrl: "/orbat-templates/enlightened.webp" },
  imperium: { accent: "#571a4e", imageUrl: "/orbat-templates/imperium.webp" },
  sultanate: { accent: "#006440", imageUrl: "/orbat-templates/sultanate.webp" },
  union: { accent: "#075792", imageUrl: "/orbat-templates/union.webp" },
};

export function orbatTemplateFor(faction: string): OrbatTemplate {
  return templates[normalize(faction)] ?? templates.empire!;
}

function normalize(value: string): string {
  const key = value.trim().toLocaleLowerCase("en");
  if (key.includes("alliance")) return "alliance";
  if (key.includes("commonwealth")) return "commonwealth";
  if (key.includes("crown")) return "crown";
  if (key.includes("empire")) return "empire";
  if (key.includes("enlightened")) return "enlightened";
  if (key.includes("imperium")) return "imperium";
  if (key.includes("sultanate")) return "sultanate";
  if (key.includes("union")) return "union";
  return key;
}
