import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  chunkDomainCatalog,
  domainCatalogSchema,
  MAX_CHUNK_BYTES,
  normalizeCatalog,
  parseCostAmount,
  reconstructDomainCatalog,
  toSafePresentation,
  type CatalogNormalizationInput,
  type ContentHasher,
  type LosslessNode,
} from "./index";

const source = {
  repository: "example/rules",
  commit: "a".repeat(40),
  tree: "b".repeat(40),
  commitTimestamp: "2026-07-29T22:05:27Z",
};
const document = { path: "synthetic.cat", blob: "c".repeat(40), sha256: "d".repeat(64) };
const hasher: ContentHasher = {
  sha256(value) {
    let hash = 2166136261;
    for (const character of value)
      hash = Math.imul(hash ^ character.codePointAt(0)!, 16777619) >>> 0;
    return Promise.resolve(hash.toString(16).padStart(8, "0").repeat(8));
  },
};

describe("normalized catalog contract", () => {
  it("uses scoped duplicate identities without fuzzy matching", () => {
    const catalog = normalize(
      root([
        node("selectionEntries", {}, [
          node("selectionEntry", { id: "same", name: "Alpha", type: "unit" }, [], "same", 1),
          node("selectionEntry", { id: "same", name: "Beta", type: "unit" }, [], "same", 2),
        ]),
      ]),
    );
    const ids = Object.keys(catalog.entities).filter((id) => id.includes(":selectionEntry:same"));
    expect(ids).toEqual(["dw4:root:selectionEntry:same", "dw4:root:selectionEntry:same~2"]);
    expect(catalog.entities[ids[1]!]!.identityQuality).toBe("duplicate");
    expect(catalog.diagnostics).toContainEqual(
      expect.objectContaining({ code: "DUPLICATE_UPSTREAM_ID" }),
    );
    expect(catalog.aliases).toEqual({});
  });

  it("keeps shared definitions immutable and placement overlays local", () => {
    const shared = node("selectionEntryGroup", { id: "shared", name: "Generators" }, [
      node("selectionEntries", {}, [
        node("selectionEntry", { id: "g1", name: "Shield", type: "upgrade" }),
      ]),
    ]);
    const catalog = normalize(
      root([
        node("sharedSelectionEntryGroups", {}, [shared]),
        node("selectionEntries", {}, [
          node("selectionEntry", { id: "ship", name: "Akita", type: "model" }, [
            node("entryLinks", {}, [
              node(
                "entryLink",
                { id: "link", name: "Generators", type: "selectionEntryGroup", targetId: "shared" },
                [
                  node("costs", {}, [
                    node("cost", { name: "Points", value: "5", typeId: "points" }),
                  ]),
                  node("constraints", {}, [
                    node("constraint", {
                      id: "limit",
                      type: "max",
                      field: "selections",
                      scope: "parent",
                      value: "1",
                    }),
                  ]),
                ],
                "link",
              ),
            ]),
          ]),
        ]),
      ]),
    );
    const reference = Object.values(catalog.placements).find(
      (placement) => placement.linkKind === "reference",
    )!;
    expect(reference.resolved).toBe(true);
    expect(reference.definitionId).toBe("dw4:root:selectionEntryGroup:shared");
    expect(reference.overlay.costIds).toHaveLength(1);
    expect(reference.overlay.constraintIds).toHaveLength(1);
    expect(catalog.entities[reference.definitionId!]!.costIds).toEqual([]);
    expect(
      Object.values(catalog.entities).filter((entity) => entity.id === reference.definitionId),
    ).toHaveLength(1);
  });

  it("preserves expression input and marks unknown semantics unevaluable", () => {
    const catalog = normalize(
      root([
        node("conditions", {}, [
          node("condition", {
            type: "futureOperator",
            field: "futureField",
            scope: "futureScope",
            value: "001.500",
            childId: "missing",
            includeChildSelections: "true",
          }),
        ]),
      ]),
    );
    const condition = Object.values(catalog.entities).find(
      (entity) => entity.kind === "Condition",
    )!;
    expect(condition.expression).toMatchObject({
      operator: "futureOperator",
      field: "futureField",
      scope: "futureScope",
      value: "001.500",
      evaluable: false,
      flags: { includeChildSelections: "true" },
      references: [],
    });
    expect(condition.expression!.unevaluableReasons).toEqual([
      "UNKNOWN_OPERATOR",
      "UNKNOWN_FIELD",
      "UNKNOWN_SCOPE",
      "UNRESOLVED_ENTITY_REFERENCE",
    ]);
  });

  it("preserves condition groups, modifiers, repeats and explicit ambiguous aliases", () => {
    const aliasOne = { ...node("alias"), text: "Legacy Name" };
    const aliasTwo = { ...node("alias"), text: "Legacy Name" };
    const catalog = normalize(
      root([
        node("rules", {}, [
          node("rule", { id: "r1", name: "Rule one" }, [aliasOne]),
          node("rule", { id: "r2", name: "Rule two" }, [aliasTwo]),
        ]),
        node("selectionEntries", {}, [
          node("selectionEntry", { id: "target", name: "Target", type: "unit" }),
          node("selectionEntry", { id: "owner", name: "Owner", type: "unit" }, [
            node("modifiers", {}, [
              node("modifier", { type: "set", field: "name", value: "kept", scope: "self" }, [
                node("conditionGroups", {}, [
                  node("conditionGroup", { type: "and" }, [
                    node("conditions", {}, [
                      node("condition", {
                        type: "atLeast",
                        field: "89fa-eeaa-958f-ca32",
                        scope: "89fa-eeaa-958f-ca32",
                        value: "1",
                        childId: "target",
                      }),
                    ]),
                  ]),
                ]),
                node("repeats", {}, [
                  node("repeat", {
                    field: "selections",
                    scope: "self",
                    value: "2",
                    repeats: "3",
                    childId: "target",
                  }),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    );
    const kinds = Object.values(catalog.entities).map((entity) => entity.kind);
    expect(kinds).toEqual(
      expect.arrayContaining(["Modifier", "ConditionGroup", "Condition", "Repeat"]),
    );
    const condition = Object.values(catalog.entities).find(
      (entity) => entity.kind === "Condition",
    )!;
    expect(condition.expression).toMatchObject({
      evaluable: true,
      references: ["dw4:root:selectionEntry:target"],
    });
    expect(condition.expression!.field).toBe("89fa-eeaa-958f-ca32");
    const alias = Object.values(catalog.aliases)[0]!;
    expect(alias).toMatchObject({ ambiguous: true, explicit: true });
    expect(alias.entityIds).toEqual(["dw4:root:rule:r1", "dw4:root:rule:r2"]);
  });

  it("sanitizes every presentation channel and provides a plain fallback", () => {
    const hostile =
      '<svg onload="alert(1)"></svg><script>steal()</script><a href="javascript:go()">Safe &amp; sound</a>';
    const safe = toSafePresentation(hostile);
    expect(safe.plainText).toBe("Safe & sound");
    expect(JSON.stringify(safe)).not.toMatch(/script|javascript|onload/iu);
    expect(safe.diagnostics).toContain("PRESENTATION_EXECUTABLE_CONTENT_REMOVED");
    const catalog = normalize(
      root([
        node("selectionEntries", {}, [
          node(
            "selectionEntry",
            { id: "x", type: "unit", name: hostile, authorUrl: "javascript:go()" },
            [
              node("profiles", {}, [
                node("profile", { id: "profile", name: "Profile", typeName: "Model" }, [
                  node("characteristics", {}, [
                    { ...node("characteristic", { name: hostile }), text: hostile },
                  ]),
                ]),
              ]),
            ],
          ),
        ]),
      ]),
    );
    const unit = Object.values(catalog.entities).find((entity) => entity.kind === "Unit")!;
    expect(unit.label.plainText).toBe("Safe & sound");
    expect(unit.attributes.authorUrl).not.toContain("javascript:");
    const profile = Object.values(catalog.entities).find((entity) => entity.kind === "Profile")!;
    expect(profile.fields[0]).toMatchObject({
      sourceTag: "characteristic",
      label: { plainText: "Safe & sound" },
      value: { plainText: "Safe & sound" },
    });
    expect(JSON.stringify(profile.fields)).not.toContain("javascript:");
  });

  it("reports dangling and ambiguous references without inventing targets", () => {
    const catalog = normalize(
      root([
        node("selectionEntries", {}, [
          node("selectionEntry", { id: "dup", type: "upgrade", name: "A" }, [], "dup", 1),
          node("selectionEntry", { id: "dup", type: "upgrade", name: "B" }, [], "dup", 2),
          node("selectionEntry", { id: "owner", type: "unit", name: "Owner" }, [
            node("entryLinks", {}, [
              node("entryLink", {
                id: "a",
                targetId: "dup",
                type: "selectionEntry",
                name: "Ambiguous",
              }),
              node("entryLink", {
                id: "b",
                targetId: "absent",
                type: "selectionEntry",
                name: "Dangling",
              }),
            ]),
          ]),
        ]),
      ]),
    );
    const references = Object.values(catalog.placements).filter(
      (placement) => placement.linkKind === "reference",
    );
    expect(
      references.map((placement) => [
        placement.resolved,
        placement.ambiguous,
        placement.definitionId,
      ]),
    ).toEqual([
      [false, true, null],
      [false, false, null],
    ]);
    expect(catalog.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["AMBIGUOUS_REFERENCE", "UNRESOLVED_REFERENCE"]),
    );
  });

  it.each([
    [undefined, { state: "missing" }],
    ["N/A", { state: "not-applicable", raw: "N/A" }],
    ["future", { state: "unknown", raw: "future" }],
    ["0.000", { state: "zero", value: "0" }],
    ["001.5000", { state: "unknown", raw: "001.5000" }],
    ["350.5000", { state: "value", value: "350.5" }],
  ])("preserves explicit cost state for %s", (raw, expected) => {
    expect(parseCostAmount(raw)).toEqual(expected);
  });

  it("keeps placement order stable for PSA/FPS-like sibling slots", () => {
    const input = root([
      node("selectionEntries", {}, [
        node("selectionEntry", { id: "akita", name: "Akita", type: "model" }, [
          node("selectionEntryGroups", {}, [
            node("selectionEntryGroup", { id: "psa", name: "Heavy Hardpoint: PSA" }),
            node("selectionEntryGroup", { id: "fps", name: "Heavy Hardpoint: FPS" }),
          ]),
        ]),
      ]),
    ]);
    const first = normalize(input);
    const second = normalize(structuredClone(input));
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    const placements = Object.values(first.placements)
      .filter((placement) => placement.definitionId?.includes("selectionEntryGroup"))
      .sort((left, right) => left.order - right.order);
    expect(placements.map((placement) => placement.order)).toEqual([0, 1]);
    expect(
      placements.map((placement) => first.entities[placement.definitionId!]!.label.plainText),
    ).toEqual(["Heavy Hardpoint: PSA", "Heavy Hardpoint: FPS"]);
  });

  it("produces bounded content-addressed chunks and reconstructs exactly", async () => {
    const catalog = normalize(
      root([
        node(
          "selectionEntries",
          {},
          Array.from({ length: 120 }, (_, index) =>
            node("selectionEntry", { id: `unit-${index}`, name: `Unit ${index}`, type: "unit" }),
          ),
        ),
      ]),
    );
    const first = await chunkDomainCatalog(catalog, hasher);
    const second = await chunkDomainCatalog(structuredClone(catalog), hasher);
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.index.chunks.every((chunk) => chunk.bytes <= MAX_CHUNK_BYTES)).toBe(true);
    const reconstructed = await reconstructDomainCatalog(first, hasher);
    expect({ ...reconstructed, contentVersion: "unversioned" }).toEqual(catalog);
    expect(domainCatalogSchema.safeParse(reconstructed).success).toBe(true);
  });

  it("maintains identity, closure, unknown preservation and decimal invariants", () => {
    for (let seed = 1; seed <= 40; seed += 1) {
      const children = Array.from({ length: (seed % 11) + 1 }, (_, index) =>
        node(
          "selectionEntry",
          {
            id: `s${seed}-${index}`,
            type: index % 2 ? "model" : "unit",
            name: `N${seed}-${index}`,
          },
          [
            node("costs", {}, [
              node("cost", { name: "Points", value: `${seed}.${index}00`, typeId: "points" }),
            ]),
          ],
        ),
      );
      const catalog = normalize(root([node("selectionEntries", {}, children)]));
      expect(new Set(Object.keys(catalog.entities)).size).toBe(
        Object.keys(catalog.entities).length,
      );
      for (const placement of Object.values(catalog.placements)) {
        expect(catalog.entities[placement.ownerId]).toBeDefined();
        if (placement.definitionId) expect(catalog.entities[placement.definitionId]).toBeDefined();
      }
      for (const entity of Object.values(catalog.entities).filter(
        (value) => value.kind === "Cost",
      )) {
        expect(entity.amount?.state).toMatch(/zero|value/);
      }
    }
  });
});

function normalize(rootNode: LosslessNode) {
  const input: CatalogNormalizationInput = {
    source,
    graph: { schemaVersion: 2, documents: [{ ...document, root: rootNode }] },
  };
  return normalizeCatalog(input);
}

function root(children: readonly LosslessNode[]): LosslessNode {
  return node(
    "catalogue",
    { id: "root", name: "Synthetic", revision: "1", gameSystemId: "system" },
    children,
    "root",
  );
}

function node(
  tag: string,
  attributes: Record<string, string> = {},
  children: readonly LosslessNode[] = [],
  keyId = attributes.id ?? `path-${fixtureCounter++}`,
  occurrence = 1,
): LosslessNode {
  return {
    key: attributes.id
      ? `${document.path}:${keyId}:${occurrence}`
      : `${document.path}:path:${keyId.replace(/^path-/u, "")}`,
    tag,
    attributes,
    ...(children.length > 0 ? { children } : {}),
  };
}

let fixtureCounter = 1;
