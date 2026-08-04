import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import type { ShipEditorReadyReadModel } from "../application/rosters/ship-editor";
import type {
  ProfileValueReadModel,
  RuleReadModel,
  WeaponProfileReadModel,
} from "../application/rosters/profile-rules";
import { orbatTemplateFor } from "../app/orbatTemplates";
import { SafeStructuredText } from "./ProfileRules";

const statFields = [
  { label: "MAS", aliases: ["mas", "mass"] },
  { label: "SPD", aliases: ["spd", "speed"] },
  { label: "TRN", aliases: ["trn", "turn"] },
  { label: "DEF", aliases: ["def", "defence", "defense"] },
  { label: "ARM", aliases: ["arm", "armour", "armor"] },
  { label: "HUL", aliases: ["hul", "hull"] },
  { label: "ACT", aliases: ["act", "actions"] },
  { label: "BRD", aliases: ["brd", "broadside"] },
  { label: "REP", aliases: ["rep", "repair"] },
  { label: "CRW", aliases: ["crw", "crew"] },
] as const;

export function ShipCardProfile({
  faction,
  model,
}: {
  readonly faction: string;
  readonly model: ShipEditorReadyReadModel;
}) {
  const [activeRule, setActiveRule] = useState<{
    readonly display: string;
    readonly kind: string;
    readonly rule: RuleReadModel;
    readonly trigger: HTMLButtonElement;
  } | null>(null);
  const template = orbatTemplateFor(faction);
  const properties = profileRow(model, ["properties", "property"]);
  const baseSystems = profileRow(model, ["systems", "system"]);
  const configuredSystems =
    model.profileRules.sections
      .find((section) => section.id === "systems")
      ?.rows.filter((row) => isUsefulValue(row.label)) ?? [];
  const systems = linkedTextEntries(baseSystems, configuredSystems);
  const weapons = uniqueWeapons(model.profileRules.weapons);
  const hardpointOptions = uniqueWeapons(
    model.groups.flatMap((group) =>
      group.options.flatMap((option) => (option.profile ? [option.profile] : [])),
    ),
  );
  const rowCount = weapons.length + hardpointOptions.length;
  const tags = uniqueText(model.card?.tags ?? [model.card?.nation, model.card?.platform]);
  const role = shortRole(model.card?.role);

  return (
    <article
      aria-label={`Карточка ${model.name}`}
      className="ship-card"
      data-density={rowCount > 11 ? "compact" : rowCount > 7 ? "dense" : "normal"}
      style={{ "--ship-card-accent": template.accent } as CSSProperties}
    >
      <img alt="" aria-hidden="true" className="ship-card__background" src={template.imageUrl} />
      <div aria-hidden="true" className="ship-card__role ship-card__role--left">
        {role}
      </div>
      <div aria-hidden="true" className="ship-card__role ship-card__role--right">
        {role}
      </div>

      <header className="ship-card__identity">
        <h3>{model.name}</h3>
        {tags.length ? <p>{tags.join(", ")}</p> : null}
      </header>
      <strong aria-label={`${model.victoryPoints} victory points`} className="ship-card__vpr">
        {model.victoryPoints}
      </strong>

      <dl className="ship-card__limits">
        <div>
          <dt>Models</dt>
          <dd>{profileValue(model, ["models"]) || model.modelQuantity.value}</dd>
        </div>
        <div>
          <dt>Escorts</dt>
          <dd>{groupLimit(model, ["escort"])}</dd>
        </div>
        <div>
          <dt>Generator hardpoints</dt>
          <dd>{groupLimit(model, ["generator", "gen hp"])}</dd>
        </div>
      </dl>

      <dl className="ship-card__stats">
        {statFields.map((stat) => (
          <div key={stat.label} title={stat.label}>
            <dt>{stat.label}</dt>
            <dd>{profileValue(model, stat.aliases) || "—"}</dd>
          </div>
        ))}
      </dl>

      <div className="ship-card__copy ship-card__copy--properties">
        <span className="visually-hidden">Properties: </span>
        {properties ? (
          <RuleLinks
            kind="Property"
            onOpenRule={openRule}
            rules={properties.rules ?? []}
            text={properties.value.plainText.trim()}
          />
        ) : (
          "—"
        )}
      </div>
      <div className="ship-card__copy ship-card__copy--systems">
        <span className="visually-hidden">Systems: </span>
        {systems.length
          ? systems.map((system, index) => (
              <span key={normalizeLabel(system.text)}>
                {index ? ", " : null}
                <RuleLinks
                  kind="System"
                  onOpenRule={openRule}
                  rules={system.rules}
                  text={system.text}
                />
              </span>
            ))
          : "—"}
      </div>

      <div
        className="ship-card__tables"
        data-has-options={hardpointOptions.length ? "true" : "false"}
      >
        <WeaponTable onOpenRule={openRule} title="Weapons" weapons={weapons} />
        {hardpointOptions.length ? (
          <WeaponTable onOpenRule={openRule} title="Hardpoint options" weapons={hardpointOptions} />
        ) : null}
      </div>
      {activeRule ? (
        <RuleDescription
          display={activeRule.display}
          kind={activeRule.kind}
          onClose={() => setActiveRule(null)}
          rule={activeRule.rule}
          trigger={activeRule.trigger}
        />
      ) : null}
    </article>
  );

  function openRule(
    rule: RuleReadModel,
    display: string,
    kind: string,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    setActiveRule({ display, kind, rule, trigger: event.currentTarget });
  }
}

function WeaponTable({
  onOpenRule,
  title,
  weapons,
}: {
  readonly onOpenRule: (
    rule: RuleReadModel,
    display: string,
    kind: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  readonly title: string;
  readonly weapons: readonly WeaponProfileReadModel[];
}) {
  return (
    <section className="ship-card__table-section">
      <h4>{title}</h4>
      <table>
        <thead>
          <tr>
            <th scope="col">Weapon</th>
            <th scope="col">Arc</th>
            <th scope="col">C</th>
            <th scope="col">S</th>
            <th scope="col">E</th>
            <th scope="col">Qualities</th>
          </tr>
        </thead>
        <tbody>
          {weapons.length ? (
            weapons.map((weapon) => (
              <tr key={weaponKey(weapon)}>
                <th scope="row">{weapon.weapon}</th>
                <td>{weapon.arc}</td>
                <td>{weapon.close}</td>
                <td>{weapon.standard}</td>
                <td>{weapon.extreme}</td>
                <td>
                  <RuleLinks
                    kind="Weapon quality"
                    onOpenRule={onOpenRule}
                    rules={weapon.qualityRules ?? []}
                    text={weapon.qualities}
                  />
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6}>—</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function RuleLinks({
  kind,
  onOpenRule,
  rules,
  text,
}: {
  readonly kind: string;
  readonly onOpenRule: (
    rule: RuleReadModel,
    display: string,
    kind: string,
    event: MouseEvent<HTMLButtonElement>,
  ) => void;
  readonly rules: readonly RuleReadModel[];
  readonly text: string;
}) {
  const matches = textMatches(text, rules);
  if (!matches.length) return text;

  const fragments: React.ReactNode[] = [];
  let offset = 0;
  for (const match of matches) {
    if (match.start > offset) fragments.push(text.slice(offset, match.start));
    fragments.push(
      <button
        aria-label={`Показать описание ${match.text}`}
        className="ship-card__trait"
        key={`${match.rule.id}:${match.start}`}
        onClick={(event) => onOpenRule(match.rule, match.text, kind, event)}
        type="button"
      >
        {match.text}
      </button>,
    );
    offset = match.end;
  }
  if (offset < text.length) fragments.push(text.slice(offset));
  return fragments;
}

function RuleDescription({
  display,
  kind,
  onClose,
  rule,
  trigger,
}: {
  readonly display: string;
  readonly kind: string;
  readonly onClose: () => void;
  readonly rule: RuleReadModel;
  readonly trigger: HTMLButtonElement;
}) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    return () => trigger.focus();
  }, [trigger]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      closeRef.current?.focus();
      return;
    }
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    onClose();
  }

  return (
    <div className="ship-card__rule-layer">
      <button
        aria-label="Закрыть описание правила по фону"
        className="ship-card__rule-dismiss"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="ship-card__rule-dialog"
        role="dialog"
      >
        <header>
          <div>
            <p>{kind}</p>
            <h4 id={titleId}>{display}</h4>
          </div>
          <button
            aria-label="Закрыть описание правила"
            onClick={onClose}
            onKeyDown={handleKeyDown}
            ref={closeRef}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="ship-card__rule-copy">
          {rule.description ? (
            <SafeStructuredText value={rule.description} />
          ) : (
            <p>{rule.diagnostic ?? "Описание правила отсутствует."}</p>
          )}
        </div>
      </section>
    </div>
  );
}

interface TextMatch {
  readonly end: number;
  readonly rule: RuleReadModel;
  readonly start: number;
  readonly text: string;
}

function textMatches(text: string, rules: readonly RuleReadModel[]): TextMatch[] {
  const candidates = rules.flatMap((rule) => {
    const pattern = new RegExp(
      `(^|[^a-z0-9])(${flexibleLabelPattern(rule.label)}(?:\\s*\\([^)]*\\))?)`,
      "iu",
    );
    const match = pattern.exec(text);
    if (!match?.[2]) return [];
    const start = match.index + match[1]!.length;
    return [{ start, end: start + match[2].length, text: match[2], rule }];
  });
  candidates.sort((left, right) => left.start - right.start || right.end - left.end);
  return candidates.filter(
    (candidate, index) =>
      !candidates.some(
        (other, otherIndex) =>
          otherIndex < index && other.start <= candidate.start && other.end > candidate.start,
      ),
  );
}

function profileValue(model: ShipEditorReadyReadModel, aliases: readonly string[]): string {
  const row = profileRow(model, aliases);
  return row?.value.plainText.trim() ?? "";
}

function profileRow(
  model: ShipEditorReadyReadModel,
  aliases: readonly string[],
): ProfileValueReadModel | null {
  const normalizedAliases = aliases.map(normalizeLabel);
  const row = model.profileRules.sections
    .flatMap((section) => section.rows)
    .find((candidate) => normalizedAliases.includes(normalizeLabel(candidate.label)));
  return row && isUsefulValue(row.value.plainText) ? row : null;
}

interface LinkedTextEntry {
  readonly rules: readonly RuleReadModel[];
  readonly text: string;
}

function linkedTextEntries(
  base: ProfileValueReadModel | null,
  configured: readonly ProfileValueReadModel[],
): LinkedTextEntry[] {
  const entries: LinkedTextEntry[] = [];
  if (base) {
    entries.push({ rules: base.rules ?? [], text: base.value.plainText.trim() });
  }
  for (const row of configured) {
    entries.push({ rules: row.rules ?? [], text: row.label.trim() });
  }

  const result = new Map<string, LinkedTextEntry>();
  for (const entry of entries) result.set(normalizeLabel(entry.text), entry);
  return [...result.values()];
}

function groupLimit(model: ShipEditorReadyReadModel, aliases: readonly string[]): string {
  const group = model.groups.find((candidate) => {
    const label = normalizeLabel(candidate.label);
    return aliases.some((alias) => label.includes(normalizeLabel(alias)));
  });
  if (!group) return "—";
  return group.minimum === group.maximum
    ? String(group.maximum)
    : `${group.minimum}–${group.maximum}`;
}

function uniqueWeapons(weapons: readonly WeaponProfileReadModel[]): WeaponProfileReadModel[] {
  const result = new Map<string, WeaponProfileReadModel>();
  for (const weapon of weapons) result.set(weaponKey(weapon), weapon);
  return [...result.values()];
}

function weaponKey(weapon: WeaponProfileReadModel): string {
  return [
    weapon.weapon,
    weapon.arc,
    weapon.close,
    weapon.standard,
    weapon.extreme,
    weapon.qualities,
  ]
    .map(normalizeLabel)
    .join("|");
}

function uniqueText(values: readonly (string | undefined)[]): string[] {
  const result = new Map<string, string>();
  for (const value of values) {
    if (!value || !isUsefulValue(value)) continue;
    result.set(normalizeLabel(value), value.trim());
  }
  return [...result.values()];
}

function isUsefulValue(value: string): boolean {
  const normalized = value.trim();
  return Boolean(normalized && normalized !== "—" && normalized !== "–");
}

function normalizeLabel(value: string): string {
  return value
    .trim()
    .toLocaleLowerCase("en")
    .replace(/[^a-zа-я0-9]+/giu, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function flexibleLabelPattern(value: string): string {
  return value
    .trim()
    .split(/[\s\-–—]+/gu)
    .map(escapeRegExp)
    .join("[\\s\\-–—]+");
}

function shortRole(value: string | undefined): string {
  const normalized = normalizeLabel(value ?? "");
  for (const role of ["flagship", "line", "patrol", "support", "scout", "logistical"])
    if (normalized.includes(role)) return role;
  return normalized.split(" ")[0] || "ship";
}
