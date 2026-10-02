import { entityId, placementId, slotId, sourceNodeId } from "./identifiers";
import { toSafePresentation } from "./presentation";
import type { DomainCatalog, DomainEntityBase, EntityKind, Model, Placement, Slot } from "./types";

const SOURCE_URL =
  "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Commonwealth-4.01_W_2026-09-28-131803_pgvm.pdf";
const SOURCE_SHA256 = "23d5f9bc067208a4c91efd09bf912ffc85c1dc08112ede4188dd834b6a5ff33f";

/** Reviewed additions from ORBAT 4.01, pp. 38/41 and the points lists on pp. 90/91.
 * Keep the locked upstream catalog intact and identify the supplemental rules explicitly.
 */
export function enrichCommonwealthOrbat(catalog: DomainCatalog): DomainCatalog {
  const entities = { ...catalog.entities };
  const placements = { ...catalog.placements };
  const slots = { ...catalog.slots };
  for (const model of Object.values(catalog.entities)) {
    if (model.kind !== "Model" || model.provenance.documentPath !== "Commonwealth.cat") continue;
    // Upstream labels the Europa unit container as a model, although it owns
    // the actual Europa model. Preserve its identity and all existing references.
    if (
      model.identity.upstreamId === "2315-c0ee-8a1e-947d" &&
      model.label.plainText === "Europa Grand Conveyor"
    ) {
      entities[model.id] = {
        ...model,
        kind: "Unit",
        attributes: {
          ...model.attributes,
          "source.url": SOURCE_URL,
          "source.page": "61",
          "derived.kind": "commonwealth-orbat-4.01-unit-correction",
        },
      };
      continue;
    }
    const page =
      model.label.plainText === "Voivode" ? 38 : model.label.plainText === "Jadwiga" ? 41 : null;
    if (!page) continue;
    const group = supplementalEntity(model, "OptionSlot", "arrays", "Ship Upgrades", page);
    if (entities[group.id]) continue;
    const id = slotId(group.id);
    const maximum = supplementalEntity(
      model,
      "Constraint",
      "arrays-max",
      "Maximum one array",
      page,
    );
    entities[maximum.id] = {
      ...maximum,
      expression: {
        contractVersion: 1,
        operator: "max",
        field: "selections",
        scope: "parent",
        value: "1",
        references: [],
        referenceResolutions: [],
        flags: { shared: "true", includeChildSelections: "false" },
        evaluable: true,
        unevaluableReasons: [],
      },
    };
    entities[group.id] = { ...group, slotIds: [id], constraintIds: [maximum.id] };
    const options: Placement[] = [];
    for (const [index, [key, name, points, system]] of [
      ["zubr", "Zubr Anti-Air Array", "5", "Flak Barrage (4)"],
      ["giyena", "Giyena Dissonance Array", "10", "Shockwave Generator"],
    ].entries()) {
      const option = supplementalEntity(model, "Option", key!, name!, page);
      const cost = supplementalEntity(model, "Cost", `${key}-points`, "Points", page);
      const profile = supplementalEntity(model, "Profile", `${key}-system`, name!, page);
      const amount = { contractVersion: 1, state: "value", value: points! } as const;
      const pointsType = Object.values(catalog.entities).find(
        (entity) => entity.kind === "CostType" && entity.label.plainText === "Points",
      );
      entities[cost.id] = {
        ...cost,
        attributes: { ...cost.attributes, value: points! },
        amount,
        semantics: {
          contractVersion: 1,
          amount,
          costTypeId: pointsType?.id ?? null,
          sourceCostTypeId: pointsType?.identity.upstreamId ?? null,
          resource: "points",
          role: "delta",
          scope: null,
        },
      };
      entities[profile.id] = {
        ...profile,
        attributes: { ...profile.attributes, typeName: "Systems" },
        fields: [
          {
            contractVersion: 1,
            sourceTag: "characteristic",
            order: 0,
            label: toSafePresentation("Systems"),
            value: toSafePresentation(system),
            attributes: { name: "Systems" },
            provenance: profile.provenance,
          },
        ],
      };
      entities[option.id] = {
        ...option,
        description: toSafePresentation(system),
        costIds: [cost.id],
        profileIds: [profile.id],
      };
      const placement: Placement = {
        contractVersion: 1,
        id: placementId(model.id, option.provenance.sourceNodeId, index),
        ownerId: model.id,
        definitionId: option.id,
        slotId: id,
        order: index,
        linkKind: "ownership",
        resolved: true,
        ambiguous: false,
        targetSourceNodeId: option.provenance.sourceNodeId,
        resolution: null,
        overlay: {
          categoryIds: [],
          costIds: [],
          constraintIds: [],
          conditionIds: [],
          modifierIds: [],
          repeatIds: [],
          attributes: {},
        },
        provenance: option.provenance,
      };
      placements[placement.id] = placement;
      options.push(placement);
    }
    const slot: Slot = {
      contractVersion: 1,
      id,
      ownerId: model.id,
      kind: "OptionSlot",
      label: group.label,
      placementIds: options.map((option) => option.id),
      optionPlacementIds: options.map((option) => option.id),
      cardinality: {
        contractVersion: 1,
        minimum: { contractVersion: 1, state: "zero", value: "0" },
        maximum: { contractVersion: 1, state: "value", value: "1" },
        effective: "deferred-to-kan-32",
      },
      costIds: [],
      constraintIds: [maximum.id],
      conditionIds: [],
      modifierIds: [],
      hidden: false,
      helper: false,
      semantics: { contractVersion: 1, selection: "option", evaluation: "deferred-to-kan-32" },
      provenance: group.provenance,
    };
    slots[id] = slot;
    entities[model.id] = { ...model, slotIds: [...model.slotIds, id] };
  }
  return { ...catalog, entities, placements, slots };
}

function supplementalEntity<K extends EntityKind>(
  model: Model,
  kind: K,
  key: string,
  name: string,
  page: number,
): DomainEntityBase<K> {
  const sourceId = sourceNodeId("commonwealth-orbat-4.01", kind, `${model.label.plainText}-${key}`);
  const id = entityId(sourceId);
  return {
    contractVersion: 1,
    id,
    kind,
    sourceTag: "orbat-supplement",
    identityQuality: "synthetic",
    identity: {
      contractVersion: 1,
      canonicalId: id,
      sourceNodeId: sourceId,
      upstreamId: null,
      occurrence: 1,
      quality: "synthetic",
      migrationAliasIds: [],
    },
    label: toSafePresentation(name),
    labels: {
      contractVersion: 1,
      canonicalLabel: name,
      sourceLabel: name,
      aliases: [],
      locale: "und",
      fallbackLabel: name,
    },
    attributes: {
      "derived.kind": "commonwealth-orbat-4.01",
      "source.url": SOURCE_URL,
      "source.sha256": SOURCE_SHA256,
      "source.version": "4.01",
      "source.page": String(page),
      "source.pointsPage": page === 38 ? "90" : "91",
    },
    fields: [],
    extensions: [],
    categoryIds: [],
    costIds: [],
    constraintIds: [],
    conditionIds: [],
    modifierIds: [],
    repeatIds: [],
    profileIds: [],
    ruleIds: [],
    slotIds: [],
    provenance: {
      ...model.provenance,
      sourceNodeId: sourceId,
      sourceTag: "orbat-supplement",
      upstreamId: null,
      xmlPath: `${SOURCE_URL}#page=${page}`,
      resolutionChain: [sourceId],
    },
  };
}
