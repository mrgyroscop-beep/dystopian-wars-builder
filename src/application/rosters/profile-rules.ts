import type {
  DomainCatalog,
  DomainEntity,
  RichTextBlock,
  RichTextInline,
  SafePresentation,
  Slot,
} from "../../domain/catalog";
import type { RosterSelectionInstance, RosterSnapshot } from "../../domain/roster";

export type ProfileSlotRole = "PSA" | "FPS 1" | "FPS 2" | "FPS 3";

export interface ProfileValueReadModel {
  readonly id: string;
  readonly label: string;
  readonly value: SafePresentation;
  readonly provenance: ProfileSlotRole | null;
}

export interface ProfileSectionReadModel {
  readonly id: "model" | "properties" | "systems";
  readonly label: "Model" | "Properties" | "Systems";
  readonly rows: readonly ProfileValueReadModel[];
}

export interface WeaponProfileReadModel {
  readonly id: string;
  readonly weapon: string;
  readonly arc: string;
  readonly close: string;
  readonly standard: string;
  readonly extreme: string;
  readonly qualities: string;
  readonly provenance: ProfileSlotRole | null;
}

export interface RuleReadModel {
  readonly id: string;
  readonly label: string;
  readonly description: SafePresentation | null;
  readonly available: boolean;
  readonly diagnostic: string | null;
}

export interface ProfileDiagnosticReadModel {
  readonly code: string;
  readonly message: string;
}

export interface ShipProfileRulesReadModel {
  readonly variant: "base" | "effective";
  readonly sourceCatalogVersion: string;
  readonly versionState: "current" | "mismatch";
  readonly sections: readonly ProfileSectionReadModel[];
  readonly weapons: readonly WeaponProfileReadModel[];
  readonly rules: readonly RuleReadModel[];
  readonly diagnostics: readonly ProfileDiagnosticReadModel[];
}

interface SourceDefinition {
  readonly entity: DomainEntity;
  readonly instance: RosterSelectionInstance | null;
  readonly provenance: ProfileSlotRole | null;
}

const emptyPresentation: SafePresentation = {
  plainText: "—",
  blocks: [{ type: "paragraph", children: [{ type: "text", value: "—" }] }],
  contentUnavailable: false,
  diagnostics: [],
};

export function projectShipProfileRules(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  unit: RosterSelectionInstance,
  model: RosterSelectionInstance,
): ShipProfileRulesReadModel {
  const diagnostics: ProfileDiagnosticReadModel[] = [];
  const baseSources = definitions(catalog, [unit, model], diagnostics);
  const configuredSources = definitions(
    catalog,
    configuredInstances(snapshot, catalog, unit, model),
    diagnostics,
  ).map((source) => ({
    ...source,
    provenance: profileProvenance(catalog, source.instance, diagnostics),
  }));
  const effectiveSources = [...baseSources, ...configuredSources];
  const versionState =
    snapshot.catalogContentVersion === catalog.contentVersion ? "current" : "mismatch";
  if (versionState === "mismatch")
    diagnostics.push({
      code: "PROFILE_CATALOG_VERSION_MISMATCH",
      message: `Состав создан для каталога ${snapshot.catalogContentVersion}; открыт каталог ${catalog.contentVersion}.`,
    });

  const baseProfiles = profileEntities(baseSources, catalog, diagnostics);
  const effectiveProfiles = profileEntities(effectiveSources, catalog, diagnostics);
  const weaponSources = effectiveProfiles.filter(({ entity }) => entity.kind === "Weapon");
  const genericBaseProfiles = baseProfiles.filter(({ entity }) => entity.kind === "Profile");
  const properties = [...baseSources, ...genericBaseProfiles].flatMap((source) =>
    [...source.entity.fields]
      .sort((left, right) => left.order - right.order)
      .map((field) => ({
        id: `${source.entity.id}:field:${field.order}`,
        label: field.label.plainText || "Свойство",
        value: field.value,
        provenance: source.provenance,
      })),
  );
  const systems = configuredSources
    .filter(({ entity }) => entity.kind !== "Weapon")
    .map((source) => ({
      id: source.entity.id,
      label: source.entity.label.plainText || "Система",
      value: source.entity.description ?? presentation("Установлено"),
      provenance: source.provenance,
    }));
  const modelDefinition = catalog.entities[model.definitionId];
  const modelRows: ProfileValueReadModel[] = [
    {
      id: `${model.definitionId}:model`,
      label: "Model",
      value: presentation(modelDefinition?.label.plainText || "Описание недоступно"),
      provenance: null,
    },
  ];

  const rules = projectRules(
    effectiveSources,
    effectiveProfiles,
    catalog,
    versionState,
    diagnostics,
  );
  return {
    variant: configuredSources.length > 0 ? "effective" : "base",
    sourceCatalogVersion: catalog.contentVersion,
    versionState,
    sections: [
      { id: "model", label: "Model", rows: modelRows },
      { id: "properties", label: "Properties", rows: properties },
      { id: "systems", label: "Systems", rows: systems },
    ],
    weapons: weaponSources.map((source) => projectWeapon(source, diagnostics)),
    rules,
    diagnostics: dedupeDiagnostics(diagnostics),
  };
}

function definitions(
  catalog: DomainCatalog,
  instances: readonly RosterSelectionInstance[],
  diagnostics: ProfileDiagnosticReadModel[],
): SourceDefinition[] {
  return instances.flatMap((instance) => {
    const entity = catalog.entities[instance.definitionId];
    if (entity) return [{ entity, instance, provenance: null }];
    diagnostics.push({
      code: "PROFILE_DEFINITION_MISSING",
      message: `Определение ${instance.definitionId} отсутствует в каталоге.`,
    });
    return [];
  });
}

function configuredInstances(
  snapshot: RosterSnapshot,
  catalog: DomainCatalog,
  unit: RosterSelectionInstance,
  model: RosterSelectionInstance,
): RosterSelectionInstance[] {
  const result: RosterSelectionInstance[] = [];
  const pending = [unit.id, model.id];
  const seen = new Set<string>(pending);
  while (pending.length > 0) {
    const ownerId = pending.shift()!;
    const children = Object.values(snapshot.instances)
      .filter(
        (candidate) =>
          candidate.parentInstanceId === ownerId &&
          candidate.id !== model.id &&
          !seen.has(candidate.id),
      )
      .sort(
        (left, right) =>
          placementOrder(catalog, left) - placementOrder(catalog, right) ||
          left.id.localeCompare(right.id),
      );
    for (const child of children) {
      seen.add(child.id);
      result.push(child);
      pending.push(child.id);
    }
  }
  return result;
}

function placementOrder(catalog: DomainCatalog, instance: RosterSelectionInstance): number {
  return instance.placementId
    ? (catalog.placements[instance.placementId]?.order ?? 1_000_000)
    : 1_000_000;
}

function profileEntities(
  sources: readonly SourceDefinition[],
  catalog: DomainCatalog,
  diagnostics: ProfileDiagnosticReadModel[],
): SourceDefinition[] {
  const result: SourceDefinition[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const ids =
      source.entity.kind === "Weapon" || source.entity.kind === "Profile"
        ? [source.entity.id, ...source.entity.profileIds]
        : source.entity.profileIds;
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      const entity = catalog.entities[id];
      if (entity?.kind === "Profile" || entity?.kind === "Weapon")
        result.push({ ...source, entity });
      else
        diagnostics.push({
          code: "PROFILE_REFERENCE_MISSING",
          message: `Профиль ${id} не найден в каталоге.`,
        });
    }
  }
  return result;
}

function profileProvenance(
  catalog: DomainCatalog,
  instance: RosterSelectionInstance | null,
  diagnostics: ProfileDiagnosticReadModel[],
): ProfileSlotRole | null {
  if (!instance?.slotId) return null;
  const slot = catalog.slots[instance.slotId];
  const role = slot?.semantics.profileRole;
  if (role) return roleLabel(role);
  if (slot?.kind === "Hardpoint")
    diagnostics.push({
      code: "PROFILE_SLOT_SEMANTICS_UNKNOWN",
      message: `Источник выбранного профиля ${instance.definitionId} не определён нормализованной семантикой слота.`,
    });
  return null;
}

function roleLabel(role: NonNullable<Slot["semantics"]["profileRole"]>): ProfileSlotRole {
  const labels: Record<NonNullable<Slot["semantics"]["profileRole"]>, ProfileSlotRole> = {
    psa: "PSA",
    "fps-1": "FPS 1",
    "fps-2": "FPS 2",
    "fps-3": "FPS 3",
  };
  return labels[role];
}

function projectWeapon(
  source: SourceDefinition,
  diagnostics: ProfileDiagnosticReadModel[],
): WeaponProfileReadModel {
  const fields = new Map(
    [...source.entity.fields]
      .sort((left, right) => left.order - right.order)
      .map((field) => [
        field.label.plainText.trim().toLocaleLowerCase("en"),
        field.value.plainText,
      ]),
  );
  const value = (name: string) => fields.get(name.toLocaleLowerCase("en")) ?? "—";
  const row = {
    id: source.entity.id,
    weapon: value("Weapon") === "—" ? source.entity.label.plainText : value("Weapon"),
    arc: value("Arc"),
    close: value("Close"),
    standard: value("Standard"),
    extreme: value("Extreme"),
    qualities: value("Qualities"),
    provenance: source.provenance,
  };
  const missing = ["Arc", "Close", "Standard", "Extreme", "Qualities"].filter(
    (field) => value(field) === "—",
  );
  if (missing.length > 0)
    diagnostics.push({
      code: "WEAPON_PROFILE_INCOMPLETE",
      message: `${row.weapon}: отсутствуют поля ${missing.join(", ")}.`,
    });
  return row;
}

function projectRules(
  sources: readonly SourceDefinition[],
  profiles: readonly SourceDefinition[],
  catalog: DomainCatalog,
  versionState: ShipProfileRulesReadModel["versionState"],
  diagnostics: ProfileDiagnosticReadModel[],
): RuleReadModel[] {
  const labels = new Map<string, string>();
  const ids: string[] = [];
  const add = (id: string, label?: string) => {
    if (!ids.includes(id)) ids.push(id);
    if (label && !labels.has(id)) labels.set(id, label);
  };
  for (const source of [...sources, ...profiles]) {
    for (const id of source.entity.ruleIds) add(id);
    collectReferences(source.entity.description?.blocks ?? [], add);
    for (const field of source.entity.fields) collectReferences(field.value.blocks, add);
  }
  return ids.map((id) => {
    const entity = catalog.entities[id];
    const validEntity = entity?.kind === "Rule" ? entity : null;
    const description = validEntity?.description ?? null;
    const available =
      versionState === "current" && Boolean(description && !description.contentUnavailable);
    const diagnostic =
      versionState === "mismatch"
        ? "Версия каталога не совпадает с версией состава."
        : !validEntity
          ? "Ссылка на правило не разрешена."
          : !description || description.contentUnavailable
            ? "Описание правила отсутствует."
            : null;
    if (diagnostic)
      diagnostics.push({
        code: !validEntity ? "RULE_REFERENCE_MISSING" : "RULE_DESCRIPTION_UNAVAILABLE",
        message: `${labels.get(id) ?? validEntity?.label.plainText ?? id}: ${diagnostic}`,
      });
    return {
      id,
      label: validEntity?.label.plainText || labels.get(id) || "Неизвестное правило",
      description: available ? description : null,
      available,
      diagnostic,
    };
  });
}

function collectReferences(
  blocks: readonly RichTextBlock[],
  add: (id: string, label?: string) => void,
): void {
  const visit = (inline: RichTextInline) => {
    if (inline.type === "reference" && inline.reference?.target)
      add(inline.reference.target, inline.value);
  };
  for (const block of blocks) {
    if (block.type === "paragraph") block.children.forEach(visit);
    if (block.type === "list") block.items.forEach((item) => item.children.forEach(visit));
    if (block.type === "table")
      block.rows.forEach((row) => row.cells.forEach((cell) => cell.children.forEach(visit)));
  }
}

function presentation(value: string): SafePresentation {
  const text = value.trim();
  if (!text) return emptyPresentation;
  return {
    plainText: text,
    blocks: [{ type: "paragraph", children: [{ type: "text", value: text }] }],
    contentUnavailable: false,
    diagnostics: [],
  };
}

function dedupeDiagnostics(
  diagnostics: readonly ProfileDiagnosticReadModel[],
): ProfileDiagnosticReadModel[] {
  const unique = new Map<string, ProfileDiagnosticReadModel>();
  for (const diagnostic of diagnostics)
    unique.set(`${diagnostic.code}:${diagnostic.message}`, diagnostic);
  return [...unique.values()];
}
