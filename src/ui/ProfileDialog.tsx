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
import { moduleLoreRussianParagraphs, moduleLoreSource, type ModuleLore } from "../app/moduleLore";
import { CameraIcon } from "./CameraIcon";
import { WeaponProfiles } from "./ProfileRules";
import { RuleDescription, RuleLinks, ShipCardProfile, ShipMobileProfile } from "./ShipCardProfile";

export function ShipProfileDialog({
  faction,
  imageSearchHref,
  model,
  name,
  onClose,
  selectedLoadout = false,
}: {
  readonly faction: string;
  readonly imageSearchHref?: string;
  readonly model: ShipEditorReadyReadModel;
  readonly name: string;
  readonly onClose: () => void;
  readonly selectedLoadout?: boolean;
}) {
  return (
    <InspectorDialog
      backgroundUrl={null}
      card
      cardToggle
      {...(imageSearchHref ? { imageSearchHref } : {})}
      name={name}
      onClose={onClose}
    >
      <ShipMobileProfile faction={faction} model={model} selectedLoadout={selectedLoadout} />
      <div className="profile-dialog__original-card">
        <ShipCardProfile faction={faction} model={model} selectedLoadout={selectedLoadout} />
      </div>
    </InspectorDialog>
  );
}

export function ShipOrbatPageDialog({
  imageUrl,
  name,
  onClose,
}: {
  readonly imageUrl: string;
  readonly name: string;
  readonly onClose: () => void;
}) {
  return (
    <InspectorDialog
      backgroundUrl={null}
      card
      closeLabel="Закрыть страницу ORBAT"
      eyebrow="Страница ORBAT"
      name={name}
      onClose={onClose}
    >
      <img
        alt={`Полная страница ORBAT для ${name}: таблица характеристик и изображение корабля`}
        className="profile-dialog__orbat-page"
        decoding="async"
        src={imageUrl}
      />
    </InspectorDialog>
  );
}

export function ShipImageDialog({
  imageUrl,
  name,
  onClose,
}: {
  readonly imageUrl: string;
  readonly name: string;
  readonly onClose: () => void;
}) {
  return (
    <InspectorDialog
      backgroundUrl={null}
      card
      closeLabel="Закрыть изображение корабля"
      contentLabel="Увеличенное изображение корабля"
      eyebrow="Изображение корабля"
      name={name}
      onClose={onClose}
    >
      <div className="profile-dialog__ship-image-stage">
        <img
          alt={`Увеличенное изображение ${name}`}
          className="profile-dialog__ship-image"
          decoding="async"
          src={imageUrl}
        />
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

export function OptionDescriptionDialog({
  description,
  name,
  onClose,
}: {
  readonly description: string;
  readonly name: string;
  readonly onClose: () => void;
}) {
  return (
    <InspectorDialog
      backgroundUrl={null}
      closeLabel="Закрыть свойства"
      compact
      eyebrow="Свойство корабля"
      name={name}
      onClose={onClose}
    >
      <div className="option-description">
        {description.split(/\n{2,}/u).map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>
    </InspectorDialog>
  );
}

export function ModuleLoreDialog({
  module,
  name,
  onClose,
}: {
  readonly module: ModuleLore;
  readonly name: string;
  readonly onClose: () => void;
}) {
  const [language, setLanguage] = useState<"ru" | "en">("ru");
  const translation = moduleLoreRussianParagraphs(module);
  const translated = language === "ru" && translation !== null;
  const paragraphs = translated ? translation : module.paragraphs;

  return (
    <InspectorDialog
      backgroundUrl={null}
      closeLabel="Закрыть изображение и лор"
      compact
      eyebrow={`Арсенал Империи · ${module.category}`}
      name={name}
      onClose={onClose}
    >
      <article className="module-lore">
        <figure className="module-lore__figure">
          <img
            alt={`${module.name} — оригинальная иллюстрация из ORBAT Империи`}
            decoding="async"
            height={module.imageHeight}
            src={module.imageUrl}
            width={module.imageWidth}
          />
          <figcaption>Иллюстрация из Tools of War</figcaption>
        </figure>
        <div className="module-lore__heading">
          <h3>История модуля</h3>
          {translation ? (
            <div aria-label="Язык лора" className="rule-language-toggle" role="group">
              <button aria-pressed={translated} onClick={() => setLanguage("ru")} type="button">
                RU · Перевод
              </button>
              <button aria-pressed={!translated} onClick={() => setLanguage("en")} type="button">
                EN · Оригинал
              </button>
            </div>
          ) : (
            <span>EN · Оригинал</span>
          )}
        </div>
        <div className="module-lore__text" lang={translated ? "ru" : "en"}>
          {paragraphs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        <footer className="module-lore__source">
          <a
            href={`${moduleLoreSource.url}#page=${module.page}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {moduleLoreSource.title} · стр. {module.page} ↗
          </a>
          <small>
            Иллюстрация и лор © Warcradle Studios.
            {translated ? " Неофициальный русский перевод." : ""} Игровые свойства — по кнопке с
            глазом.
          </small>
        </footer>
      </article>
    </InspectorDialog>
  );
}

function InspectorDialog({
  backgroundUrl,
  card = false,
  cardToggle = false,
  children,
  closeLabel = "Закрыть профиль",
  compact = false,
  contentLabel,
  eyebrow = "Профиль ORBAT",
  imageSearchHref,
  name,
  onClose,
}: {
  readonly backgroundUrl: string | null;
  readonly card?: boolean;
  readonly cardToggle?: boolean;
  readonly children: ReactNode;
  readonly closeLabel?: string;
  readonly compact?: boolean;
  readonly contentLabel?: string;
  readonly eyebrow?: string;
  readonly imageSearchHref?: string;
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
        data-card-view={cardToggle ? cardView : undefined}
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
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={titleId}>{name}</h2>
          </div>
          <div className="profile-dialog__header-actions">
            {imageSearchHref ? (
              <a
                aria-label={`Найти изображения ${name} в Google`}
                className="profile-dialog__image-search"
                href={imageSearchHref}
                rel="noopener noreferrer"
                target="_blank"
                title="Найти изображение в Google"
              >
                <CameraIcon />
              </a>
            ) : null}
            {cardToggle ? (
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
              aria-label={closeLabel}
              className="profile-dialog__close"
              onClick={onClose}
              type="button"
            >
              <CloseIcon />
            </button>
          </div>
        </header>
        <div
          aria-label={contentLabel ?? (card ? "Профиль корабля" : undefined)}
          className="profile-dialog__content"
          role={card ? "region" : undefined}
          tabIndex={card ? 0 : undefined}
        >
          {children}
        </div>
      </dialog>
      <button
        aria-label={`${closeLabel} по фону`}
        className="profile-dialog__dismiss"
        onClick={onClose}
        type="button"
      />
    </div>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="profile-dialog__close-icon" viewBox="0 0 24 24">
      <path d="m7 7 10 10M17 7 7 17" />
    </svg>
  );
}
