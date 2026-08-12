import { describe, expect, it } from "vitest";

import { shipImageFor } from "./shipImages";

describe("shipImageFor", () => {
  it("resolves extracted ORBAT art independently of punctuation and case", () => {
    expect(shipImageFor("Crown", "SABRE COMMAND CRUISER")).toBe("/ships/crown/28.webp");
  });

  it("leaves explicitly missing ORBAT art available for a silhouette fallback", () => {
    expect(shipImageFor("Commonwealth", "Borodino Battleship")).toBeNull();
  });
});
