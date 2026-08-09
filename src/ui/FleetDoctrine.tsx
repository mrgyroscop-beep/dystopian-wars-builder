import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type {
  FleetDoctrineCommand,
  FleetDoctrineReadModel,
  ShipEditorOptionReadModel,
} from "../application/rosters/ship-editor";
import { EyeIcon } from "./EyeIcon";
import { useRuleTranslation } from "./GlossaryContext";

export function FleetDoctrinePanel({
  busy,
  doctrine,
  onCommand,
}: {
  readonly busy: boolean;
  readonly doctrine: FleetDoctrineReadModel;
  readonly onCommand: (command: FleetDoctrineCommand, announcement: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [inspected, setInspected] = useState<ShipEditorOptionReadModel | null>(null);
  const panelId = useId();
  const selected = doctrine.groups.flatMap((group) =>
    group.options.filter((option) => option.selectedQuantity > 0),
  );

  return (
    <section className="fleet-doctrine" aria-labelledby={`${panelId}-title`}>
      <button
        aria-controls={`${panelId}-content`}
        aria-expanded={open}
        className="fleet-doctrine__toggle"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="fleet-doctrine__mark" aria-hidden="true">
          ◆
        </span>
        <span className="fleet-doctrine__copy">
          <span className="eyebrow">Первый элемент состава</span>
          <strong id={`${panelId}-title`}>Доктрина флота</strong>
          <small>
            {selected.length
              ? selected.map((option, index) => (
                  <span key={option.id}>
                    {index > 0 ? " · " : null}
                    <DoctrineTitle doctrine={option} />
                  </span>
                ))
              : "Не выбрана"}
          </small>
        </span>
        <span className="fleet-doctrine__chevron" aria-hidden="true">
          {open ? "−" : "+"}
        </span>
      </button>

      {open ? (
        <div className="fleet-doctrine__content" id={`${panelId}-content`}>
          {doctrine.groups.map((group, groupIndex) => (
            <fieldset className="fleet-doctrine__group" key={group.id}>
              <legend>{group.label}</legend>
              <p>{group.help}</p>
              <div className="fleet-doctrine__options">
                {group.options.map((option, optionIndex) => (
                  <DoctrineOption
                    busy={busy}
                    doctrine={option}
                    inputId={`${panelId}-${groupIndex}-${optionIndex}`}
                    key={option.id}
                    name={
                      doctrine.selectionMode === "one-per-group"
                        ? `fleet-doctrine-${groupIndex}`
                        : `fleet-doctrine-${doctrine.ownerInstanceId}`
                    }
                    onInspect={() => setInspected(option)}
                    onSelect={(label) =>
                      onCommand(
                        {
                          type: "set-fleet-doctrine",
                          instanceId: doctrine.ownerInstanceId,
                          optionId: option.id,
                        },
                        `Выбрана доктрина ${label}.`,
                      )
                    }
                  />
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      ) : null}

      {inspected ? (
        <DoctrineDescriptionDialog doctrine={inspected} onClose={() => setInspected(null)} />
      ) : null}
    </section>
  );
}

function DoctrineTitle({ doctrine }: { readonly doctrine: ShipEditorOptionReadModel }) {
  const localized = useRuleTranslation(doctrine.label);
  return localized.language === "ru" && localized.translation
    ? localized.translation.title
    : doctrine.label;
}

function DoctrineOption({
  busy,
  doctrine,
  inputId,
  name,
  onInspect,
  onSelect,
}: {
  readonly busy: boolean;
  readonly doctrine: ShipEditorOptionReadModel;
  readonly inputId: string;
  readonly name: string;
  readonly onInspect: () => void;
  readonly onSelect: (label: string) => void;
}) {
  const localized = useRuleTranslation(doctrine.label);
  const translated = localized.language === "ru" ? localized.translation : null;
  const label = translated?.title ?? doctrine.label;
  const englishFallback =
    localized.language === "ru" && !localized.loading && !localized.translation;
  const unavailable = doctrine.availability !== "available";
  const checked = doctrine.selectedQuantity > 0;
  return (
    <div
      className="fleet-doctrine__option"
      data-availability={doctrine.availability}
      data-selected={checked ? "true" : undefined}
    >
      <label aria-label={label} htmlFor={inputId}>
        <input
          checked={checked}
          disabled={busy || unavailable}
          id={inputId}
          name={name}
          onChange={() => onSelect(label)}
          type="radio"
        />
        <span>
          <strong>{label}</strong>
          <small>
            {translated ? `${doctrine.label} · ` : ""}
            {englishFallback ? "Оригинал EN · " : ""}
            {doctrine.reason ?? doctrine.costLabel}
          </small>
        </span>
      </label>
      <button
        aria-label={`Показать описание доктрины ${label}`}
        className="fleet-doctrine__inspect"
        onClick={onInspect}
        type="button"
      >
        <EyeIcon />
      </button>
    </div>
  );
}

function DoctrineDescriptionDialog({
  doctrine,
  onClose,
}: {
  readonly doctrine: ShipEditorOptionReadModel;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const localized = useRuleTranslation(doctrine.label);
  const translated = localized.language === "ru" ? localized.translation : null;
  const englishFallback =
    localized.language === "ru" && !localized.loading && !localized.translation;

  useEffect(() => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("button")?.focus();
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
        "button:not([disabled]), a[href], [tabindex='0']",
      ) ?? []),
    ];
    if (!focusable.length) return;
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
    <div className="dialog-backdrop doctrine-dialog-backdrop">
      <dialog
        aria-labelledby={titleId}
        aria-modal="true"
        className="doctrine-dialog"
        onKeyDown={handleKeyDown}
        open
        ref={dialogRef}
      >
        <header>
          <div>
            <p className="eyebrow">Доктрина флота</p>
            <h2 id={titleId}>{translated?.title ?? doctrine.label}</h2>
            {translated ? <small>{doctrine.label}</small> : null}
          </div>
          <button aria-label="Закрыть описание доктрины" onClick={onClose} type="button">
            ×
          </button>
        </header>
        {englishFallback ? (
          <p className="doctrine-dialog__fallback" role="status">
            Перевод пока недоступен. Ниже показан английский оригинал из каталога.
          </p>
        ) : null}
        <p className="doctrine-dialog__description">
          {translated?.text ||
            doctrine.description ||
            "Описание этой доктрины отсутствует в текущем каталоге."}
        </p>
      </dialog>
      <button
        aria-label="Закрыть описание доктрины по фону"
        className="doctrine-dialog__dismiss"
        onClick={onClose}
        tabIndex={-1}
        type="button"
      />
    </div>
  );
}
