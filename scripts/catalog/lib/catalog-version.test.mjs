import { describe, expect, it } from "vitest";
import { compareCatalogVersions } from "./catalog-version.mjs";

const timestamp = "2026-08-01T00:00:00Z";
let releaseSequence = 0;

describe("catalog version comparator contract", () => {
  it("classifies complete vectors and consults timestamps only after revision equality", () => {
    expect(compare(version(["1", "2"]), version(["1", "2"]))).toBe("EQUAL");
    expect(
      compare(version(["2", "3"], "2020-01-01T00:00:00Z"), version(["1", "2"], timestamp)),
    ).toBe("NEWER");
    expect(
      compare(version(["1", "2"], "2030-01-01T00:00:00Z"), version(["2", "3"], timestamp)),
    ).toBe("OLDER");
    expect(
      compare(version(["2", "1"], "2030-01-01T00:00:00Z"), version(["1", "2"], timestamp)),
    ).toBe("INCOMPARABLE");
    expect(compare(version(["1", "2"], "2026-08-02T00:00:00Z"), version(["1", "2"]))).toBe("NEWER");
    expect(compare(version(["1", "2"], "2026-07-31T00:00:00Z"), version(["1", "2"]))).toBe("OLDER");
    expect(compare(version(["1", "2"], timestamp), version(["1", "2"], timestamp))).toBe("EQUAL");
    expect(compare(version(["1", "2"], "2026-08-01T00:00:00.000Z"), version(["1", "2"]))).toBe(
      "UNKNOWN",
    );
  });

  it.each([
    ["missing", (candidate) => candidate.manifest.inventory.pop()],
    ["extra", (candidate) => candidate.manifest.inventory.push(entry("extra.cat", "1", "extra"))],
    [
      "duplicate",
      (candidate) => candidate.manifest.inventory.push({ ...candidate.manifest.inventory[0] }),
    ],
    ["kind mismatch", (candidate) => (candidate.manifest.inventory[0].kind = "gameSystem")],
    ["id mismatch", (candidate) => (candidate.manifest.inventory[0].id = "other")],
    ["nondecimal", (candidate) => (candidate.manifest.inventory[0].revision = "1.0")],
    ["noncanonical path", (candidate) => (candidate.manifest.inventory[0].path = "./a.cat")],
  ])("returns UNKNOWN for %s inventory", (_name, mutate) => {
    const candidate = version(["1", "2"]);
    mutate(candidate);
    expect(compare(candidate, version(["1", "2"]))).toBe("UNKNOWN");
  });

  it("obeys reflexivity, inversion, Pareto, permutation, metadata invariance, and BigInt rules", () => {
    const active = version(["0002", "999999999999999999999999999999"]);
    const equal = version(["2", "0999999999999999999999999999999"]);
    expect(compare(active, active)).toBe("EQUAL");
    expect(compare(equal, active)).toBe("EQUAL");

    const newer = version(["3", "1000000000000000000000000000000"], "2020-01-01T00:00:00Z");
    expect(compare(newer, active)).toBe("NEWER");
    expect(compare(active, newer)).toBe("OLDER");
    newer.manifest.source.resolved.commitTimestamp = "invalid";
    expect(compare(newer, active)).toBe("NEWER");
    newer.manifest.inventory.reverse();
    expect(compare(newer, active)).toBe("NEWER");

    const metadataOnly = structuredClone(equal);
    metadataOnly.releaseId = "f".repeat(64);
    metadataOnly.manifest.source.resolved.commit = "metadata-only";
    metadataOnly.manifest.source.resolved.tree = "metadata-only";
    metadataOnly.manifest.source.files = [{ blob: "metadata-only" }];
    expect(compare(metadataOnly, active)).toBe("EQUAL");

    const mixed = version(["3", "1"], "2030-01-01T00:00:00Z");
    expect(compare(mixed, active)).toBe("INCOMPARABLE");
    mixed.manifest.source.resolved.commitTimestamp = "invalid";
    expect(compare(mixed, active)).toBe("INCOMPARABLE");
  });

  it("fast-paths identical release IDs but never treats different IDs as novelty", () => {
    const malformed = version(["invalid"]);
    const sameId = version(["1"]);
    malformed.releaseId = sameId.releaseId;
    expect(compare(malformed, sameId)).toBe("EQUAL");

    const left = version(["1", "2"]);
    const right = version(["1", "2"]);
    left.releaseId = "c".repeat(64);
    right.releaseId = "d".repeat(64);
    expect(compare(left, right)).toBe("EQUAL");
  });
});

function compare(candidate, active) {
  return compareCatalogVersions(candidate, active);
}

function version(revisions, commitTimestamp = timestamp) {
  releaseSequence += 1;
  return {
    releaseId: releaseSequence.toString(16).padStart(64, "0"),
    manifest: {
      inventory: revisions.map((revision, index) => entry(`${index}.cat`, revision, `id-${index}`)),
      source: { resolved: { commitTimestamp, commit: "a", tree: "b" }, files: [] },
    },
  };
}

function entry(path, revision, id) {
  return { path, revision, kind: "catalogue", id };
}
