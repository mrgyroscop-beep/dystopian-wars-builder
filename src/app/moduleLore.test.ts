import { describe, expect, it } from "vitest";

import { moduleLoreFor, moduleLoreRussianParagraphs } from "./moduleLore";

describe("module lore lookup", () => {
  it.each([
    ["Alliance", "Focussed Heavy Rocket Battery", "heavy-rocket-battery"],
    ["Alliance", "Focused Torpedo Turrets", "light-torpedo-turret"],
    ["Alliance", "Sharpshooter Heavy Magnetic Bombard", "heavy-magnetic-bombard"],
    ["Crown", "Extreme Range Light Gun Battery", "light-gun-battery"],
    ["Crown", "Guardian Generator (2)", "guardian-generator"],
    ["Sultanate", "Heavy Shield Generator (3)", "heavy-shield-generator"],
    ["Enlightened", "Heavy ESCF Gun Battery", "heavy-gun-battery"],
    ["Enlightened", "ESCF Light Rocket Battery", "light-rocket-battery"],
    ["Sultanate", "Repulsion Generator", "repulsion-field-generator"],
    ["Commonwealth", "Tracer Tri-Railgun", "tri-railgun"],
    ["Imperium", "Guided Stromschlag Rocket Battery", "stromschlag-rocket-battery"],
    ["Empire", "Focused Light Huoqiang", "light-huoqiang"],
  ])("resolves %s / %s without confusing its faction", (faction, name, id) => {
    const module = moduleLoreFor(faction, name);
    expect(module?.faction).toBe(faction);
    expect(module?.id).toBe(id);
    expect(module?.imageUrl).toContain(`/modules/${faction.toLowerCase()}/`);
  });

  it("keeps both language versions of shared generator names faction-specific", () => {
    const crown = moduleLoreFor("Crown", "Fury Generator")!;
    const sultanate = moduleLoreFor("Sultanate", "Fury Generator")!;
    expect(crown.paragraphs.join(" ")).toContain("Warcradle");
    expect(sultanate.paragraphs.join(" ")).toContain("Ayşe Marangoz");
    expect(moduleLoreRussianParagraphs(crown)?.join(" ")).toContain("Карпатиана");
    expect(moduleLoreRussianParagraphs(sultanate)?.join(" ")).toContain("Айше Марангоз");
    expect(crown.source.url).not.toBe(sultanate.source.url);
  });
});
