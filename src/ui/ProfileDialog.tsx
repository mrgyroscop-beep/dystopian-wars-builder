import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import type {
  ShipProfileRulesReadModel,
  WeaponProfileReadModel,
} from "../application/rosters/profile-rules";
import { ProfilePanel, WeaponProfiles } from "./ProfileRules";

export function ShipProfileDialog({
  backgroundUrl,
  model,
  name,
  onClose,
}: {
  readonly backgroundUrl: string | null;
  readonly model: ShipProfileRulesReadModel;
  readonly name: string;
  readonly onClose: () => void;
}) {
  return (
    <InspectorDialog backgroundUrl={backgroundUrl} name={name} onClose={onClose}>
      <ProfilePanel model={model} />
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
  return (
    <InspectorDialog backgroundUrl={null} name={profile.weapon} onClose={onClose} compact>
      <WeaponProfiles weapons={[profile]} />
    </InspectorDialog>
  );
}

function InspectorDialog({
  backgroundUrl,
  children,
  compact = false,
  name,
  onClose,
}: {
  readonly backgroundUrl: string | null;
  readonly children: ReactNode;
  readonly compact?: boolean;
  readonly name: string;
  readonly onClose: () => void;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

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
    <div className="dialog-backdrop profile-dialog-backdrop">
      <dialog
        aria-labelledby={titleId}
        aria-modal="true"
        className="profile-dialog"
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
          <button aria-label="Закрыть профиль" onClick={onClose} type="button">
            ×
          </button>
        </header>
        <div className="profile-dialog__content">{children}</div>
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
