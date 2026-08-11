import { describe, expect, it } from "vitest";

import { orbatCardFor } from "./orbatCards";

describe("orbatCardFor", () => {
  it("resolves a published card by faction and normalized ship name", () => {
    expect(orbatCardFor("Empire", "Akita Super Battleship")).toBe("/orbat-cards/empire/23.webp");
  });

  it("resolves the review fixture to its official Akita page", () => {
    expect(orbatCardFor("Empire", "Akita Demonstrator")).toBe("/orbat-cards/empire/23.webp");
  });

  it("returns null when no original card is mapped", () => {
    expect(orbatCardFor("Unknown faction", "Unpublished ship")).toBeNull();
  });
});
