import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import type { RichTextBlock, RichTextInline } from "../domain/catalog";
import type {
  ProfileSectionReadModel,
  RuleReadModel,
  ShipProfileRulesReadModel,
} from "../application/rosters/profile-rules";

export function SafeStructuredText({
  value,
  onReference,
}: {
  readonly value: unknown;
  readonly onReference?: (ruleId: string, returnElement: HTMLElement) => void;
}) {
  const blocks = safeBlocks(value);
  if (!blocks) return <p className="structured-text__unavailable">Описание недоступно</p>;
  return (
    <div className="structured-text">
      {blocks.map((block, index) => (
        <StructuredBlock
          block={block}
          key={`${block.type}-${index}`}
          {...(onReference ? { onReference } : {})}
        />
      ))}
    </div>
  );
}

export function ProfilePanel({ model }: { readonly model: ShipProfileRulesReadModel }) {
  return (
    <div className="profile-panel">
      <header className="profile-panel__heading">
        <div>
          <p className="preview-category">
            {model.variant === "base" ? "Базовый профиль" : "Эффективный профиль"}
          </p>
          <h4>Профиль корабля</h4>
        </div>
        <span className="catalog-version">Каталог {model.sourceCatalogVersion}</span>
      </header>
      {model.sections.map((section) => (
        <ProfileSection key={section.id} section={section} />
      ))}
      <WeaponProfiles weapons={model.weapons} />
      {model.diagnostics.length > 0 ? (
        <details className="profile-diagnostics">
          <summary>Диагностика данных ({model.diagnostics.length})</summary>
          <ul>
            {model.diagnostics.map((diagnostic) => (
              <li key={`${diagnostic.code}:${diagnostic.message}`}>{diagnostic.message}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function WeaponProfiles({
  weapons,
}: {
  readonly weapons: ShipProfileRulesReadModel["weapons"];
}) {
  const columns = ["Weapon", "Arc", "Close", "Standard", "Extreme", "Qualities"] as const;
  if (weapons.length === 0)
    return (
      <section className="weapon-profiles" aria-labelledby="weapon-profiles-title">
        <h4 id="weapon-profiles-title">Weapons</h4>
        <p className="profile-empty">Профили вооружения не опубликованы.</p>
      </section>
    );
  return (
    <section className="weapon-profiles" aria-labelledby="weapon-profiles-title">
      <h4 id="weapon-profiles-title">Weapons</h4>
      <div className="weapon-table-wrap">
        <table className="weapon-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weapons.map((weapon) => (
              <tr key={weapon.id}>
                <th scope="row">
                  {weapon.weapon}
                  {weapon.provenance ? <small>{weapon.provenance}</small> : null}
                </th>
                <td>{weapon.arc}</td>
                <td>{weapon.close}</td>
                <td>{weapon.standard}</td>
                <td>{weapon.extreme}</td>
                <td>{weapon.qualities}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="weapon-cards" aria-label="Профили вооружения">
        {weapons.map((weapon) => (
          <article className="weapon-card" key={weapon.id}>
            <header>
              <strong>{weapon.weapon}</strong>
              {weapon.provenance ? <span>{weapon.provenance}</span> : null}
            </header>
            <dl>
              {columns.slice(1).map((column) => (
                <div key={column}>
                  <dt>{column}</dt>
                  <dd>{weapon[column.toLocaleLowerCase("en") as keyof typeof weapon]}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </section>
  );
}

export function RulesPanel({
  model,
  onOpenRule,
}: {
  readonly model: ShipProfileRulesReadModel;
  readonly onOpenRule: (ruleId: string, returnElement: HTMLElement) => void;
}) {
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  return (
    <div className="rules-panel">
      <header className="rules-panel__heading">
        <div>
          <p className="preview-category">Связанные правила</p>
          <h4>Правила корабля</h4>
        </div>
        <button onClick={() => setGlossaryOpen(true)} type="button">
          Глоссарий
        </button>
      </header>
      {model.rules.length > 0 ? (
        <ul className="rule-list">
          {model.rules.map((rule) => (
            <li key={rule.id}>
              <button
                aria-label={`Открыть правило ${rule.label}`}
                onClick={(event) => onOpenRule(rule.id, event.currentTarget)}
                type="button"
              >
                <span>
                  <strong>{rule.label}</strong>
                  <small>{rule.available ? "Описание доступно" : "Описание недоступно"}</small>
                </span>
                <b aria-hidden="true">→</b>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="profile-empty">Для этого корабля нет связанных правил.</p>
      )}
      <p className="rules-panel__version">Источник: каталог {model.sourceCatalogVersion}</p>
      {glossaryOpen ? (
        <GlossaryDialog
          onClose={() => setGlossaryOpen(false)}
          onOpenRule={onOpenRule}
          rules={model.rules}
        />
      ) : null}
    </div>
  );
}

export function RuleSheet({
  model,
  ruleId,
  onBack,
  onOpenRule,
}: {
  readonly model: ShipProfileRulesReadModel;
  readonly ruleId: string;
  readonly onBack: () => void;
  readonly onOpenRule: (ruleId: string, returnElement: HTMLElement) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rule = model.rules.find((candidate) => candidate.id === ruleId) ?? null;
  useEffect(() => headingRef.current?.focus(), [ruleId]);
  return (
    <article className="rule-sheet" aria-labelledby="rule-sheet-title">
      <button className="rule-sheet__back" onClick={onBack} type="button">
        ← К правилам
      </button>
      <p className="preview-category">Карточка правила</p>
      <h4 id="rule-sheet-title" ref={headingRef} tabIndex={-1}>
        {rule?.label ?? "Правило не найдено"}
      </h4>
      {rule?.available ? (
        <SafeStructuredText value={rule.description} onReference={onOpenRule} />
      ) : (
        <div className="rule-unavailable" role="note">
          <strong>Описание недоступно</strong>
          <p>{rule?.diagnostic ?? "Ссылка на правило не разрешена."}</p>
        </div>
      )}
      <p className="rules-panel__version">Источник: каталог {model.sourceCatalogVersion}</p>
    </article>
  );
}

export function GlossaryDialog({
  rules,
  onClose,
  onOpenRule,
}: {
  readonly rules: readonly RuleReadModel[];
  readonly onClose: () => void;
  readonly onOpenRule: (ruleId: string, returnElement: HTMLElement) => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button, [tabindex='0']")?.focus();
    return () => returnFocus.current?.focus();
  }, []);
  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), [tabindex='0']",
      ) ?? []),
    ];
    if (focusable.length === 0) return;
    const current = focusable.indexOf(document.activeElement as HTMLElement);
    const next = event.shiftKey
      ? current <= 0
        ? focusable.length - 1
        : current - 1
      : (current + 1) % focusable.length;
    event.preventDefault();
    focusable[next]?.focus();
  }
  return (
    <div className="dialog-backdrop">
      <dialog
        aria-labelledby={titleId}
        aria-modal="true"
        className="glossary-dialog"
        onKeyDown={handleKeyDown}
        open
        ref={dialogRef}
      >
        <header>
          <h4 id={titleId}>Глоссарий</h4>
          <button aria-label="Закрыть глоссарий" onClick={onClose} type="button">
            ×
          </button>
        </header>
        {rules.length > 0 ? (
          <ul>
            {rules.map((rule) => (
              <li key={rule.id}>
                <button onClick={(event) => onOpenRule(rule.id, event.currentTarget)} type="button">
                  {rule.label}
                  <span aria-hidden="true">→</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>Связанных терминов нет.</p>
        )}
      </dialog>
    </div>
  );
}

function ProfileSection({ section }: { readonly section: ProfileSectionReadModel }) {
  return (
    <section className="profile-section" aria-labelledby={`profile-section-${section.id}`}>
      <h4 id={`profile-section-${section.id}`}>{section.label}</h4>
      {section.rows.length > 0 ? (
        <dl>
          {section.rows.map((row) => (
            <div key={row.id}>
              <dt>{row.label}</dt>
              <dd>
                {row.value.plainText || "—"}
                {row.provenance ? <small>{row.provenance}</small> : null}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="profile-empty">Нет опубликованных данных.</p>
      )}
    </section>
  );
}

function StructuredBlock({
  block,
  onReference,
}: {
  readonly block: RichTextBlock;
  readonly onReference?: (ruleId: string, returnElement: HTMLElement) => void;
}) {
  if (block.type === "paragraph") return <p>{renderInline(block.children, onReference)}</p>;
  if (block.type === "list") {
    const List = block.ordered ? "ol" : "ul";
    return (
      <List>
        {block.items.map((item, index) => (
          <li key={index}>{renderInline(item.children, onReference)}</li>
        ))}
      </List>
    );
  }
  return (
    <div className="structured-table-wrap">
      <table>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.cells.map((cell, cellIndex) => {
                const Cell = cell.header ? "th" : "td";
                return <Cell key={cellIndex}>{renderInline(cell.children, onReference)}</Cell>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderInline(
  children: readonly RichTextInline[],
  onReference?: (ruleId: string, returnElement: HTMLElement) => void,
): ReactNode[] {
  return children.map((inline, index) => {
    if (inline.type === "lineBreak") return <br key={index} />;
    if (inline.type === "strong") return <strong key={index}>{inline.value}</strong>;
    if (inline.type === "emphasis") return <em key={index}>{inline.value}</em>;
    if (inline.type === "reference" && inline.reference?.state === "resolved" && onReference)
      return (
        <button
          className="structured-reference"
          key={index}
          onClick={(event) => onReference(inline.reference!.target, event.currentTarget)}
          type="button"
        >
          {inline.value}
        </button>
      );
    return inline.value ?? "";
  });
}

function safeBlocks(value: unknown): readonly RichTextBlock[] | null {
  const candidate = record(value);
  if (!candidate || !Array.isArray(candidate.blocks) || candidate.blocks.length === 0) return null;
  return candidate.blocks.every(validBlock) ? (candidate.blocks as readonly RichTextBlock[]) : null;
}

function validBlock(value: unknown): boolean {
  const block = record(value);
  if (!block) return false;
  if (block.type === "paragraph")
    return Array.isArray(block.children) && block.children.every(validInline);
  if (block.type === "list")
    return (
      typeof block.ordered === "boolean" &&
      Array.isArray(block.items) &&
      block.items.every((item) => {
        const candidate = record(item);
        return (
          candidate?.type === "listItem" &&
          Array.isArray(candidate.children) &&
          candidate.children.every(validInline)
        );
      })
    );
  if (block.type === "table")
    return (
      Array.isArray(block.rows) &&
      block.rows.every((row) => {
        const candidate = record(row);
        return (
          candidate?.type === "tableRow" &&
          Array.isArray(candidate.cells) &&
          candidate.cells.every((cell) => {
            const item = record(cell);
            return (
              item?.type === "tableCell" &&
              typeof item.header === "boolean" &&
              Array.isArray(item.children) &&
              item.children.every(validInline)
            );
          })
        );
      })
    );
  return false;
}

function validInline(value: unknown): boolean {
  const inline = record(value);
  if (
    !inline ||
    !["text", "strong", "emphasis", "lineBreak", "reference"].includes(String(inline.type))
  )
    return false;
  if (inline.type === "lineBreak") return true;
  if (typeof inline.value !== "string") return false;
  if (inline.type !== "reference") return true;
  const reference = record(inline.reference);
  return Boolean(
    reference &&
    (reference.state === "resolved" || reference.state === "unresolved") &&
    typeof reference.target === "string" &&
    reference.target.length > 0 &&
    reference.target.length <= 240 &&
    !/^(?:https?|javascript|data|vbscript|mailto):|^\/\//iu.test(reference.target),
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
