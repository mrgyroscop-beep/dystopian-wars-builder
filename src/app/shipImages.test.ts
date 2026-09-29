import { describe, expect, it } from "vitest";

import { shipImageFor } from "./shipImages";

describe("shipImageFor", () => {
  it("resolves extracted ORBAT art independently of punctuation and case", () => {
    expect(shipImageFor("Crown", "SABRE COMMAND CRUISER")).toBe("/ships/crown/28.webp");
    expect(shipImageFor("Enlightened", "Agora Command Cruiser")).toBe("/ships/enlightened/19.webp");
    expect(shipImageFor("Sultanate", "Abydos Hover Stronghold")).toBe("/ships/sultanate/19.webp");
    expect(shipImageFor("Commonwealth", "Borodino Battleship")).toBe("/ships/commonwealth/23.webp");
    expect(shipImageFor("Commonwealth", "Marena Vitruvian Colossus")).toBe(
      "/ships/commonwealth/58.webp",
    );
  });

  it("leaves explicitly missing ORBAT art available for a silhouette fallback", () => {
    expect(shipImageFor("Commonwealth", "Morozko Heavy Cryo Cruiser")).toBeNull();
  });
});
