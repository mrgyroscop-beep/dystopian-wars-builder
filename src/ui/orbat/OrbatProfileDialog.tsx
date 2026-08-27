import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getOrbatProfileImage, type OrbatProfile } from "./orbatProfiles";

interface OrbatProfileDialogProps {
  profile: OrbatProfile;
  onClose: () => void;
}

const zoomLevels = [75, 100, 125, 150] as const;

export function OrbatProfileDialog({ profile, onClose }: OrbatProfileDialogProps) {
  const [zoom, setZoom] = useState<number>(100);
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const imageUrl = getOrbatProfileImage(profile);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div className="orbat-dialog-backdrop">
      <section aria-labelledby={titleId} aria-modal="true" className="orbat-dialog" role="dialog">
        <header className="orbat-dialog__header">
          <div className="orbat-dialog__identity">
            <p className="eyebrow">
              Empire ORBAT v{profile.sourceVersion} · страница {profile.page}
            </p>
            <h2 id={titleId}>{profile.name}</h2>
          </div>

          <div className="orbat-dialog__actions">
            <div aria-label="Масштаб страницы" className="orbat-zoom" role="group">
              {zoomLevels.map((level) => (
                <button
                  aria-pressed={zoom === level}
                  className="orbat-zoom__button"
                  key={level}
                  onClick={() => setZoom(level)}
                  type="button"
                >
                  {level}%
                </button>
              ))}
            </div>
            <a className="orbat-dialog__original" href={imageUrl} rel="noreferrer" target="_blank">
              Открыть отдельно
            </a>
            <button
              aria-label="Закрыть профиль корабля"
              className="orbat-dialog__close"
              onClick={onClose}
              ref={closeButtonRef}
              type="button"
            >
              ×
            </button>
          </div>
        </header>

        <div className="orbat-dialog__viewport">
          <img
            alt={`Полная страница профиля ${profile.name}: таблица характеристик и изображение корабля`}
            className="orbat-dialog__page"
            src={imageUrl}
            style={{ width: `${zoom}%` }}
          />
        </div>
      </section>
    </div>,
    document.body,
  );
}
