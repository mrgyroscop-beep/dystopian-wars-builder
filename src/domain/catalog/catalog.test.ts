import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  chunkDomainCatalog,
  domainCatalogSchema,
  MAX_CHUNK_BYTES,
  PINNED_DW4_VOCABULARY,
  loadDomainCatalog,
  normalizeCatalog,
  parseCostAmount,
  persistChunkedCatalog,
  reconstructDomainCatalog,
  sourceNodeId,
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
    expect(catalog.entities[ids[1]!]!.identityQuality).toBe("scoped");
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
    expect(condition.expression.unevaluableReasons).toEqual([
      "UNKNOWN_OPERATOR",
      "UNKNOWN_FIELD",
      "UNKNOWN_SCOPE",
      "UNRESOLVED_ENTITY_REFERENCE",
    ]);
  });

  it("recognizes ship-editor operators, fields and ancestor/unit scopes", () => {
    const catalog = normalize(
      root([
        node("selectionEntries", {}, [
          node("selectionEntry", { id: "target", name: "Target", type: "upgrade" }),
          node("selectionEntry", { id: "owner", name: "Owner", type: "unit" }, [
            node("conditions", {}, [
              node("condition", {
                type: "lessThan",
                field: "selections",
                scope: "unit",
                value: "2",
                childId: "target",
              }),
              node("condition", {
                type: "notInstanceOf",
                field: "hidden",
                scope: "ancestor",
                value: "1",
                childId: "target",
              }),
            ]),
            node("modifiers", {}, [
              node("modifier", {
                type: "append",
                field: "error",
                scope: "unit",
                value: "Requirement text",
              }),
            ]),
          ]),
        ]),
      ]),
    );
    const expressions = Object.values(catalog.entities)
      .filter((entity) => "expression" in entity)
      .map((entity) => entity.expression);
    expect(expressions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operator: "lessThan",
          field: "selections",
          scope: "unit",
          evaluable: true,
          unevaluableReasons: [],
        }),
        expect.objectContaining({
          operator: "notInstanceOf",
          field: "hidden",
          scope: "ancestor",
          evaluable: true,
          unevaluableReasons: [],
        }),
        expect.objectContaining({
          operator: "append",
          field: "error",
          scope: "unit",
          evaluable: true,
          unevaluableReasons: [],
        }),
      ]),
    );
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
    expect(condition.expression.field).toBe("89fa-eeaa-958f-ca32");
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
    const rootNode = root([
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
    ]);
    const catalog = normalizeCatalog(
      { source, graph: { schemaVersion: 2, documents: [{ ...document, root: rootNode }] } },
      { referencePolicy: "report" },
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
    [undefined, { contractVersion: 1, state: "missing" }],
    ["N/A", { contractVersion: 1, state: "not-applicable", raw: "N/A" }],
    ["future", { contractVersion: 1, state: "unknown", raw: "future" }],
    ["0.000", { contractVersion: 1, state: "zero", value: "0" }],
    ["001.5000", { contractVersion: 1, state: "unknown", raw: "001.5000" }],
    ["350.5000", { contractVersion: 1, state: "value", value: "350.5" }],
  ])("preserves explicit cost state for %s", (raw, expected) => {
    expect(parseCostAmount(raw)).toEqual(expected);
  });

  it("publishes complete identity, label, provenance, cost and slot contracts", () => {
    const catalog = normalize(
      root([
        node("selectionEntryGroups", {}, [
          node("selectionEntryGroup", { id: "slot", name: "Loadout", hidden: "true" }, [
            node("constraints", {}, [
              node("constraint", { id: "min", type: "min", field: "selections", value: "1" }),
              node("constraint", { id: "max", type: "max", field: "selections", value: "2" }),
            ]),
            node("modifiers", {}, [
              node("modifier", {
                id: "hide-slot",
                type: "set",
                field: "hidden",
                value: "true",
              }),
            ]),
            node("selectionEntries", {}, [
              node("selectionEntry", { id: "choice", name: "Choice", type: "upgrade" }, [
                node("costs", {}, [
                  node("cost", { id: "cost", name: "Points", typeId: "points", value: "5" }),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),
    );
    const faction = Object.values(catalog.entities).find((entity) => entity.kind === "Faction")!;
    expect(faction.identity).toMatchObject({
      canonicalId: faction.id,
      sourceNodeId: faction.provenance.sourceNodeId,
      occurrence: 1,
      quality: "upstream",
    });
    expect(faction.labels).toMatchObject({
      canonicalLabel: "Synthetic",
      sourceLabel: "Synthetic",
      aliases: [],
      locale: "und",
      fallbackLabel: "Synthetic",
    });
    expect(faction.provenance.xmlPath).toContain("root");
    expect(faction.provenance).toMatchObject({
      occurrence: 1,
      resolutionChain: [faction.provenance.sourceNodeId],
      sourceRevision: source.commit,
      importRevision: 2,
      schemaRevision: "1.0.0",
    });
    const cost = Object.values(catalog.entities).find((entity) => entity.kind === "Cost")!;
    expect(cost.semantics).toMatchObject({
      amount: { state: "value", value: "5" },
      costTypeId: null,
      sourceCostTypeId: "points",
      resource: "points",
      role: "base",
      scope: null,
    });
    const slot = Object.values(catalog.slots)[0]!;
    expect(slot).toMatchObject({
      hidden: true,
      helper: false,
      cardinality: {
        minimum: { state: "value", value: "1" },
        maximum: { state: "value", value: "2" },
        effective: "deferred-to-kan-32",
      },
    });
    expect(slot.optionPlacementIds).toHaveLength(1);
    expect(
      catalog.entities[catalog.placements[slot.optionPlacementIds[0]!]!.definitionId!]!.kind,
    ).toBe("Option");
    expect(slot.constraintIds).toHaveLength(2);
    expect(slot.modifierIds).toHaveLength(1);
    expect(catalog.entities[slot.modifierIds[0]!]!).toMatchObject({
      kind: "Modifier",
      expression: { field: "hidden", value: "true", evaluable: true },
    });
    const slotPlacement = Object.values(catalog.placements).find(
      (placement) => placement.definitionId === slot.ownerId,
    )!;
    expect(slotPlacement.overlay.cardinality).toMatchObject({
      minimum: { state: "value", value: "1" },
      maximum: { state: "value", value: "2" },
    });
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
    expect(first.index).toMatchObject({
      format: "dwb-domain-catalog",
      manifestVersion: 1,
      sourceSchemaVersion: 2,
      sourceCommit: source.commit,
    });
    expect(first.index.views.coreChunk).toMatch(/^[0-9a-f]{64}$/u);
    expect(first.index.views.glossaryChunk).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      first.index.chunks
        .filter((chunk) => chunk.kind === "entities")
        .every((chunk) => chunk.bucket?.match(/^(?:[0-9a-f]{2})+$/u)),
    ).toBe(true);
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

  it("encodes canonical ID segments injectively and rejects graph identity collisions", () => {
    expect(sourceNodeId("root", "tag", "a b")).not.toBe(sourceNodeId("root", "tag", "a-b"));
    expect(sourceNodeId("root", "tag", "x~2")).not.toBe(sourceNodeId("root", "tag", "x", 2));
    expect(sourceNodeId("r:1", "tag", "x")).not.toBe(sourceNodeId("r", "1:tag", "x"));

    const duplicateDocument = root([
      node("selectionEntries", {}, [
        node("selectionEntry", { id: "same", type: "unit", name: "One" }, [], "same"),
      ]),
    ]);
    const input: CatalogNormalizationInput = {
      source,
      graph: {
        schemaVersion: 2,
        documents: [
          { ...document, path: "one.cat", root: duplicateDocument },
          { ...document, path: "two.cat", root: structuredClone(duplicateDocument) },
        ],
      },
    };
    expect(() => normalizeCatalog(input)).toThrow(/identity collision/iu);
    const repeated = node("selectionEntry", { id: "repeat", type: "unit", name: "Repeat" });
    expect(() => normalize(root([node("selectionEntries", {}, [repeated, repeated])]))).toThrow(
      /identity collision/iu,
    );
  });

  it("rejects tampered indexes, lookup coverage and broken reference closure", async () => {
    const catalog = normalize(
      root([
        node("selectionEntries", {}, [
          node("selectionEntry", { id: "unit", type: "unit", name: "Unit" }),
        ]),
      ]),
    );
    const chunked = await chunkDomainCatalog(catalog, hasher);
    await expect(
      reconstructDomainCatalog(
        {
          ...chunked,
          index: { ...chunked.index, contentVersion: "0".repeat(64) },
        },
        hasher,
      ),
    ).rejects.toThrow(/index|content version/iu);
    await expect(
      reconstructDomainCatalog(
        {
          ...chunked,
          index: { ...chunked.index, entityChunkById: {} },
        },
        hasher,
      ),
    ).rejects.toThrow(/lookup|index|content version/iu);

    const placementId = Object.keys(catalog.placements)[0]!;
    const broken = {
      ...catalog,
      placements: {
        ...catalog.placements,
        [placementId]: {
          ...catalog.placements[placementId]!,
          ownerId: "dw4:missing:owner:id" as never,
        },
      },
    };
    await expect(
      reconstructDomainCatalog(await chunkDomainCatalog(broken, hasher), hasher),
    ).rejects.toThrow(/closure/iu);

    const schemaInvalid = structuredClone(catalog) as unknown as {
      entities: Record<string, Record<string, unknown>>;
    };
    delete schemaInvalid.entities[Object.keys(schemaInvalid.entities)[0]!]!.label;
    await expect(
      reconstructDomainCatalog(
        await chunkDomainCatalog(schemaInvalid as unknown as typeof catalog, hasher),
        hasher,
      ),
    ).rejects.toThrow(/domain schema/iu);
  });

  it("uses structural vocabulary rather than display labels", () => {
    const structuralHardpoint = node(
      "selectionEntryGroup",
      { id: "slot", name: "Completely arbitrary" },
      [
        node("selectionEntries", {}, [
          node("selectionEntry", { id: "option", type: "upgrade", name: "Choice" }, [
            node("profiles", {}, [
              node("profile", {
                id: "weapon",
                typeId: "9882-7112-4aa5-ffc1",
                typeName: "Not a display hint",
                name: "Profile",
              }),
            ]),
          ]),
        ]),
      ],
    );
    const catalog = normalize(
      root([
        node("selectionEntryGroups", {}, [
          structuralHardpoint,
          node("selectionEntryGroup", { id: "fake", name: "Hardpoint Generator Escort" }),
        ]),
      ]),
    );
    expect(
      Object.values(catalog.entities).find((entity) => entity.id.endsWith(":slot"))?.kind,
    ).toBe("Hardpoint");
    expect(
      Object.values(catalog.entities).find((entity) => entity.id.endsWith(":fake"))?.kind,
    ).toBe("OptionSlot");
    expect(
      Object.values(catalog.entities).find((entity) => entity.id.endsWith(":weapon"))?.kind,
    ).toBe("Weapon");
  });

  it("normalizes profile slot provenance from explicit vocabulary, never its label", () => {
    const input: CatalogNormalizationInput = {
      source,
      graph: {
        schemaVersion: 2,
        documents: [
          {
            ...document,
            root: root([
              node("selectionEntryGroups", {}, [
                node("selectionEntryGroup", { id: "slot", name: "PSA misleading label" }),
              ]),
            ]),
          },
        ],
      },
    };
    const explicit = normalizeCatalog(input, {
      vocabulary: {
        ...PINNED_DW4_VOCABULARY,
        profileSlotRoles: { slot: "fps-2" },
      },
    });
    expect(Object.values(explicit.slots)[0]?.semantics.profileRole).toBe("fps-2");
    expect(Object.values(normalizeCatalog(input).slots)[0]?.semantics.profileRole).toBeNull();
  });

  it("preserves safe rich-text AST, extensions and reportable unresolved resolution chains", () => {
    const future = {
      ...node("futureExtension", { mode: "future" }),
      text: "kept",
      children: [{ ...node("futureChild", { flag: "yes" }), text: "nested" }],
    };
    const linked = node("selectionEntry", { id: "owner", type: "unit", name: "Owner" }, [
      node("description", {}, [], "description"),
      future,
      node("profiles", {}, [
        node("profile", { id: "profile", name: "Profile" }, [
          node("characteristics", {}, [
            node("characteristic", { name: "Known field" }, [
              { ...node("futureFieldChild", { mode: "nested" }), text: "preserved" },
            ]),
          ]),
        ]),
      ]),
      node("entryLinks", {}, [
        node("entryLink", {
          id: "missing-link",
          targetId: "missing",
          type: "selectionEntry",
          name: "Missing",
        }),
      ]),
    ]);
    const description = linked.children![0]! as LosslessNode & { richText: unknown };
    (description as { richText: unknown }).richText = {
      type: "document",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "strong", value: "Bold" },
            { type: "emphasis", value: " emphasis" },
            { type: "reference", value: "Known", targetEntityId: "dw4:root:Rule:known" },
            { type: "reference", value: "Missing", targetId: "missing" },
            { type: "lineBreak" },
            { type: "future-inline", value: "kept in plain fallback" },
          ],
        },
        {
          type: "list",
          ordered: false,
          items: [{ type: "listItem", children: [{ type: "text", value: "First" }] }],
        },
        {
          type: "table",
          rows: [
            {
              type: "tableRow",
              cells: [
                { type: "tableCell", header: true, children: [{ type: "text", value: "Cell" }] },
              ],
            },
          ],
        },
      ],
      plainText: "Bold\nCell",
      contentUnavailable: false,
      diagnostics: [],
    };
    const input = root([node("selectionEntries", {}, [linked])]);
    expect(() => normalize(input)).toThrow(/reference/iu);
    const catalog = normalizeCatalog(
      { source, graph: { schemaVersion: 2, documents: [{ ...document, root: input }] } },
      { referencePolicy: "report" },
    );
    const owner = Object.values(catalog.entities).find((entity) => entity.id.endsWith(":owner"))!;
    expect(owner.description?.blocks.map((block) => block.type)).toEqual([
      "paragraph",
      "list",
      "table",
    ]);
    expect(owner.description?.diagnostics).toEqual(
      expect.arrayContaining([
        "PRESENTATION_REFERENCE_UNRESOLVED",
        "PRESENTATION_UNSUPPORTED_INLINE",
      ]),
    );
    expect(owner.extensions).toEqual([
      expect.objectContaining({
        sourceTag: "futureExtension",
        children: [expect.objectContaining({ sourceTag: "futureChild" })],
      }),
    ]);
    const profile = Object.values(catalog.entities).find((entity) =>
      entity.id.endsWith(":profile"),
    )!;
    expect(profile.extensions).toHaveLength(1);
    expect(profile.extensions[0]?.sourceTag).toBe("futureFieldChild");
    expect(profile.extensions[0]?.value.plainText).toBe("preserved");
    const unresolved = Object.values(catalog.placements).find(
      (placement) => placement.linkKind === "reference",
    )!;
    expect(unresolved.resolution).toMatchObject({
      state: "unresolved",
      upstreamId: "missing",
      chain: [unresolved.provenance.sourceNodeId],
    });
  });

  it("persists and loads a validated indexed repository", async () => {
    const catalog = normalize(
      root([
        node("selectionEntries", {}, [
          node("selectionEntry", { id: "unit", type: "unit", name: "Unit" }),
        ]),
      ]),
    );
    const chunked = await chunkDomainCatalog(catalog, hasher);
    const indexes = new Map<string, typeof chunked.index>();
    const storedChunks = new Map<string, string>();
    const port = {
      contractVersion: 1 as const,
      writeChunk(sha256: string, value: string) {
        storedChunks.set(sha256, value);
        return Promise.resolve();
      },
      writeIndex(index: typeof chunked.index) {
        indexes.set(index.contentVersion, index);
        return Promise.resolve();
      },
      loadIndex(contentVersion: string) {
        const index = indexes.get(contentVersion);
        if (!index) return Promise.reject(new Error("missing index"));
        return Promise.resolve(index);
      },
      loadChunk(sha256: string) {
        const value = storedChunks.get(sha256);
        if (!value) return Promise.reject(new Error("missing chunk"));
        return Promise.resolve(value);
      },
    };
    await persistChunkedCatalog(chunked, port);
    const loaded = await loadDomainCatalog(chunked.index.contentVersion, port, hasher);
    expect(loaded.contentVersion).toBe(chunked.index.contentVersion);
    const target = Object.keys(loaded.entities)[0]!;
    const started = performance.now();
    for (let index = 0; index < 10_000; index += 1) expect(loaded.entities[target]).toBeDefined();
    expect((performance.now() - started) / 10_000).toBeLessThan(50);
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
