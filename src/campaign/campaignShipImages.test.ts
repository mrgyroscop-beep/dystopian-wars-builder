import { describe, expect, it } from "vitest";

import { campaignShipImage } from "./campaignShipImages";

const profilesWithOrbatArt = [
  "bunya",
  "buredo",
  "chaudharys-revenge",
  "crows",
  "diyu-huo",
  "kamarupa",
  "nagato",
  "pembroke",
  "sentosa",
  "shinsei",
  "skua",
  "ssang",
  "strikakulam",
  "taiyo-furea",
  "tulwar",
] as const;

describe("campaignShipImage", () => {
  it.each(profilesWithOrbatArt)("maps %s to an extracted WebP", (profileId) => {
    expect(campaignShipImage(profileId)).toMatch(/^\/campaign\/ships\/.+\.webp$/);
  });

  it("does not substitute an unrelated platform for Ashmore Refinery", () => {
    expect(campaignShipImage("ashmore-refinery")).toBeNull();
  });
});
