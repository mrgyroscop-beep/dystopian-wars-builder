import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import type { ShipEditorReadyReadModel } from "../application/rosters/ship-editor";
import type { RuleReadModel, WeaponProfileReadModel } from "../application/rosters/profile-rules";
import { WeaponProfiles } from "./ProfileRules";
import { RuleDescription, RuleLinks, ShipCardProfile, ShipMobileProfile } from "./ShipCardProfile";

export function ShipProfileDialog({
  faction,
  model,
  name,
  onClose,
}: {
  readonly faction: string;
  readonly model: ShipEditorReadyReadModel;
  readonly name: string;
  readonly onClose: () => void;
}) {
  return (
    <InspectorDialog backgroundUrl={null} card name={name} onClose={onClose}>
      <ShipMobileProfile faction={faction} model={model} />
      <div className="profile-dialog__original-card">
        <ShipCardProfile faction={faction} model={model} />
      </div>
    </InspectorDialog>
  );
}

export function WeaponProfileDialog({
  profile,
  onClose,
}: {
  readonly profile: WeaponProfileReadModel;
  readonly onClose: () => void;
}) {
  const [activeRule, setActiveRule] = useState<{
    readonly display: string;
    readonly rule: RuleReadModel;
    readonly trigger: HTMLButtonElement;
  } | null>(null);
  return (
    <InspectorDialog backgroundUrl={null} name={profile.weapon} onClose={onClose} compact>
      <WeaponProfiles
        renderQualities={(weapon) => (
          <RuleLinks
            kind="Weapon quality"
            onOpenRule={openRule}
            rules={weapon.qualityRules ?? []}
            text={weapon.qualities}
          />
        )}
        weapons={[profile]}
      />
      {activeRule ? (
        <RuleDescription
          display={activeRule.display}
          kind="Weapon quality"
          onClose={() => setActiveRule(null)}
          rule={activeRule.rule}
          trigger={activeRule.trigger}
        />
      ) : null}
    </InspectorDialog>
  );

  function openRule(
    rule: RuleReadModel,
    display: string,
    _kind: string,
    event: MouseEvent<HTMLButtonElement>,
  ) {
    setActiveRule({ display, rule, trigger: event.currentTarget });
  }
}

function InspectorDialog({
  backgroundUrl,
  card = false,
  children,
  compact = false,
  name,
  onClose,
}: {
  readonly backgroundUrl: string | null;
  readonly card?: boolean;
  readonly children: ReactNode;
  readonly compact?: boolean;
  readonly name: string;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [cardView, setCardView] = useState<"profile" | "original">("profile");

  useEffect(() => {
    returnFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>(".profile-dialog__close")?.focus();
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
    <div className="dialog-backdrop profile-dialog-backdrop">
      <dialog
        aria-labelledby={titleId}
        aria-modal="true"
        className="profile-dialog"
        data-card={card ? "true" : undefined}
        data-card-view={card ? cardView : undefined}
        data-compact={compact ? "true" : undefined}
        onKeyDown={handleKeyDown}
        open
        ref={dialogRef}
      >
        {backgroundUrl ? (
          <img
            alt=""
            aria-hidden="true"
            className="profile-dialog__background"
            src={backgroundUrl}
          />
        ) : null}
        <div className="profile-dialog__veil" aria-hidden="true" />
        <header className="profile-dialog__header">
          <div>
            <p className="eyebrow">Профиль ORBAT</p>
            <h2 id={titleId}>{name}</h2>
          </div>
          <div className="profile-dialog__header-actions">
            {card ? (
              <button
                aria-label={
                  cardView === "profile"
                    ? "Показать оригинальную карточку"
                    : "Показать мобильный профиль"
                }
                className="profile-dialog__view-toggle"
                onClick={() =>
                  setCardView((current) => (current === "profile" ? "original" : "profile"))
                }
                type="button"
              >
                {cardView === "profile" ? "Оригинал" : "Профиль"}
              </button>
            ) : null}
            <button
              aria-label="Закрыть профиль"
              className="profile-dialog__close"
              onClick={onClose}
              type="button"
            >
              ×
            </button>
          </div>
        </header>
        <div
          aria-label={card ? "Профиль корабля" : undefined}
          className="profile-dialog__content"
          role={card ? "region" : undefined}
          tabIndex={card ? 0 : undefined}
        >
          {children}
        </div>
      </dialog>
      <button
        aria-label="Закрыть профиль по фону"
        className="profile-dialog__dismiss"
        onClick={onClose}
        type="button"
      />
    </div>
  );
}
