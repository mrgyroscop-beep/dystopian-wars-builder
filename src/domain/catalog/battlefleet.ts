import { placementId } from "./identifiers";
import type { DomainCatalog, DomainEntity, EntityId, Modifier, Placement } from "./types";

const DERIVED_PLACEMENT = "battlefleet-category-membership";

/**
 * BattleScribe stores Battlefleet membership as category links on root entries,
 * not as child entries of the Battlefleet element. Convert those links into the
 * explicit placements used by the roster editor and evaluator.
 */
export function enrichBattlefleetCatalog(catalog: DomainCatalog): DomainCatalog {
  const placements: Record<string, Placement> = { ...catalog.placements };
  const allPlacements = Object.values(catalog.placements);
  const allEntities = Object.values(catalog.entities);

  for (const faction of allEntities.filter((entity) => entity.kind === "Faction")) {
    const sourcePlacements = allPlacements.filter((placement) => {
      if (placement.ownerId !== faction.id || !placement.definitionId || !placement.resolved)
        return false;
      const definition = catalog.entities[placement.definitionId];
      return definition?.kind === "Unit" || definition?.kind === "Model";
    });
    const battlefleets = allEntities.filter(
      (entity) =>
        entity.kind === "Battlefleet" &&
        entity.provenance.documentPath === faction.provenance.documentPath,
    );

    for (const battlefleet of battlefleets) {
      const elements = allPlacements.flatMap((placement) => {
        if (placement.ownerId !== battlefleet.id || !placement.definitionId) return [];
        const definition = catalog.entities[placement.definitionId];
        if (definition?.kind !== "BattlefleetElement") return [];
        const category = resolveCategory(
          definition.attributes.targetId,
          definition.provenance.documentPath,
          allEntities,
        );
        return category ? [{ definition, category }] : [];
      });

      for (const { definition: element, category } of elements) {
        const seenDefinitions = new Set<string>();
        let order = 0;
        for (const source of sourcePlacements) {
          const ship = source.definitionId ? catalog.entities[source.definitionId] : undefined;
          if (!ship || seenDefinitions.has(ship.id)) continue;
          if (!placementApplies(source, ship, battlefleet.id, catalog)) continue;
          const categories = effectiveCategories(
            source,
            ship,
            battlefleet.id,
            catalog,
            allEntities,
          );
          if (!categories.has(category.id)) continue;

          const id = placementId(element.id, source.provenance.sourceNodeId, order, "reference");
          order += 1;
          placements[id] = {
            ...source,
            id,
            ownerId: element.id,
            order,
            linkKind: "reference",
            targetSourceNodeId: ship.identity.sourceNodeId,
            resolution: {
              contractVersion: 1,
              state: "resolved",
              upstreamId: ship.identity.upstreamId ?? ship.id,
              entityId: ship.id,
              sourceNodeId: ship.identity.sourceNodeId,
              chain: [source.provenance.sourceNodeId, ship.identity.sourceNodeId],
            },
            overlay: {
              ...source.overlay,
              categoryIds: [...categories].sort(),
              attributes: {
                ...source.overlay.attributes,
                "derived.kind": DERIVED_PLACEMENT,
                "derived.sourcePlacementId": source.id,
              },
            },
          };
          seenDefinitions.add(ship.id);
        }
      }
    }
  }

  return { ...catalog, placements };
}

function placementApplies(
  placement: Placement,
  definition: DomainEntity,
  battlefleetId: EntityId,
  catalog: DomainCatalog,
): boolean {
  if (!conditionsApply(placement.overlay.conditionIds, battlefleetId, catalog)) return false;
  let hidden =
    definition.attributes.hidden === "true" || placement.overlay.attributes.hidden === "true";
  for (const modifier of modifiersFor(placement, definition, catalog)) {
    if (
      modifier.expression.field !== "hidden" ||
      modifier.expression.operator !== "set" ||
      !conditionsApply(modifier.conditionIds, battlefleetId, catalog)
    )
      continue;
    if (modifier.expression.value === "true") hidden = true;
    if (modifier.expression.value === "false") hidden = false;
  }
  return !hidden;
}

function effectiveCategories(
  placement: Placement,
  definition: DomainEntity,
  battlefleetId: EntityId,
  catalog: DomainCatalog,
  entities: readonly DomainEntity[],
): Set<EntityId> {
  const result = new Set<EntityId>([...definition.categoryIds, ...placement.overlay.categoryIds]);
  for (const modifier of modifiersFor(placement, definition, catalog)) {
    if (
      modifier.expression.field !== "category" ||
      (modifier.expression.operator !== "add" && modifier.expression.operator !== "set-primary") ||
      !conditionsApply(modifier.conditionIds, battlefleetId, catalog)
    )
      continue;
    const category = resolveCategory(
      modifier.expression.value,
      modifier.provenance.documentPath,
      entities,
    );
    if (category) result.add(category.id);
  }
  return result;
}

function modifiersFor(
  placement: Placement,
  definition: DomainEntity,
  catalog: DomainCatalog,
): readonly Modifier[] {
  return [...definition.modifierIds, ...placement.overlay.modifierIds].flatMap((id) => {
    const modifier = catalog.entities[id];
    return modifier?.kind === "Modifier" ? [modifier] : [];
  });
}

function conditionsApply(
  ids: readonly EntityId[],
  battlefleetId: EntityId,
  catalog: DomainCatalog,
): boolean {
  return ids.every((id) => evaluateCondition(id, battlefleetId, catalog, new Set()) === true);
}

function evaluateCondition(
  id: EntityId,
  battlefleetId: EntityId,
  catalog: DomainCatalog,
  visited: Set<EntityId>,
): boolean | null {
  if (visited.has(id)) return null;
  visited.add(id);
  const entity = catalog.entities[id];
  if (!entity || (entity.kind !== "Condition" && entity.kind !== "ConditionGroup")) return null;
  if (entity.kind === "ConditionGroup") {
    const values = entity.conditionIds.map((child) =>
      evaluateCondition(child, battlefleetId, catalog, new Set(visited)),
    );
    if (entity.expression.operator === "or") return values.some((value) => value === true);
    return values.every((value) => value === true);
  }

  const battlefleetReferences = entity.expression.references.filter(
    (reference) => catalog.entities[reference]?.kind === "Battlefleet",
  );
  if (battlefleetReferences.length === 0) return null;
  const actual = battlefleetReferences.includes(battlefleetId) ? 1 : 0;
  const expected = Number(entity.expression.value ?? "1");
  if (!Number.isFinite(expected)) return null;
  switch (entity.expression.operator) {
    case "instanceOf":
    case "atLeast":
      return actual >= expected;
    case "equalTo":
      return actual === expected;
    case "notInstanceOf":
    case "lessThan":
      return actual < expected;
    case "atMost":
      return actual <= expected;
    case "greaterThan":
      return actual > expected;
    default:
      return null;
  }
}

function resolveCategory(
  upstreamId: string | null | undefined,
  documentPath: string,
  entities: readonly DomainEntity[],
): DomainEntity | undefined {
  if (!upstreamId) return undefined;
  const candidates = entities.filter(
    (entity) => entity.kind === "Category" && entity.identity.upstreamId === upstreamId,
  );
  return (
    candidates.find((entity) => entity.provenance.documentPath === documentPath) ?? candidates[0]
  );
}
