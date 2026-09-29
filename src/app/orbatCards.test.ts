import { describe, expect, it } from "vitest";

import { orbatCardFor } from "./orbatCards";

describe("orbatCardFor", () => {
  it("resolves a published card by faction and normalized ship name", () => {
    expect(orbatCardFor("Empire", "Akita Super Battleship")).toBe("/orbat-cards/empire/23.webp");
  });

  it("resolves the review fixture to its official Akita page", () => {
    expect(orbatCardFor("Empire", "Akita Demonstrator")).toBe("/orbat-cards/empire/23.webp");
  });

  it("maps Commonwealth catalog spellings to the official 4.01 profiles", () => {
    expect(orbatCardFor("Commonwealth", "Jadwiga Airborne Monitor")).toBe(
      "/orbat-cards/commonwealth/41.webp",
    );
    expect(orbatCardFor("Commonwealth", "Yak Transport Hovercraft")).toBe(
      "/orbat-cards/commonwealth/60.webp",
    );
    expect(orbatCardFor("Commonwealth", "Europa Grand Conveyor")).toBe(
      "/orbat-cards/commonwealth/61.webp",
    );
    expect(orbatCardFor("Commonwealth", "Titan Mass Conveyor")).toBe(
      "/orbat-cards/commonwealth/64.webp",
    );
  });

  it("returns null when no original card is mapped", () => {
    expect(orbatCardFor("Unknown faction", "Unpublished ship")).toBeNull();
  });
});
