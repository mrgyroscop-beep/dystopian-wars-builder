import { useMemo } from "react";

import {
  orbatProfileCategories,
  type OrbatProfile,
  type OrbatProfileCategory,
} from "./orbatProfiles";

export const sectionCapacity: Record<OrbatProfileCategory, number> = {
  Flagship: 1,
  Line: 6,
  Patrol: 6,
  Support: 3,
  Scout: 3,
  Logistical: 1,
};

const attachments = ["", "Heavy Gun Battery", "Light Alchemical Rockets", "Generator"];

export interface FleetShip {
  attachment: string;
  escortCount: number;
  instanceId: string;
  modelCount: number;
  profile: OrbatProfile;
}

interface FleetCompositionEditorProps {
  onRequestCategory: (category: OrbatProfileCategory) => void;
  onSelectedShipChange: (instanceId: string | null) => void;
  onShipsChange: (ships: readonly FleetShip[]) => void;
  selectedShipId: string | null;
  ships: readonly FleetShip[];
}

export function FleetCompositionEditor({
  onRequestCategory,
  onSelectedShipChange,
  onShipsChange,
  selectedShipId,
  ships,
}: FleetCompositionEditorProps) {
  const selectedShip = useMemo(
    () => ships.find((ship) => ship.instanceId === selectedShipId) ?? null,
    [selectedShipId, ships],
  );

  const updateSelectedShip = (change: Partial<Omit<FleetShip, "instanceId" | "profile">>) => {
    if (!selectedShipId) return;
    const nextShips = ships.map((ship) =>
      ship.instanceId === selectedShipId ? { ...ship, ...change } : ship,
    );
    onShipsChange(nextShips);
  };

  const removeShip = (instanceId: string) => {
    const nextShips = ships.filter((ship) => ship.instanceId !== instanceId);
    if (selectedShipId === instanceId) onSelectedShipChange(null);
    onShipsChange(nextShips);
  };

  return (
    <div className="fleet-builder">
      <div className="composition-sections">
        <section className="composition-section composition-section--doctrine">
          <div className="composition-section__heading">
            <div>
              <p className="eyebrow">Первый элемент состава</p>
              <h3>Доктрина флота</h3>
            </div>
            <span className="composition-section__doctrine-mark" aria-hidden="true">
              ◆
            </span>
          </div>
          <p className="composition-section__meta">Доктрина всегда располагается первой.</p>
        </section>

        {orbatProfileCategories.map((category) => {
          const categoryShips = ships.filter((ship) => ship.profile.category === category);
          const capacity = sectionCapacity[category];

          return (
            <section className="composition-section" key={category}>
              <div className="composition-section__heading">
                <div>
                  <h3>{category}</h3>
                  <p className="composition-section__meta">
                    {categoryShips.length} выбрано · максимум {capacity}
                  </p>
                </div>
                <span className="badge">
                  {categoryShips.length}/{capacity}
                </span>
              </div>

              {categoryShips.length > 0 ? (
                <ul className="composition-ship-list">
                  {categoryShips.map((ship) => (
                    <li
                      className={
                        ship.instanceId === selectedShipId
                          ? "composition-ship composition-ship--selected"
                          : "composition-ship"
                      }
                      key={ship.instanceId}
                    >
                      <button
                        aria-label={`Открыть настройки ${ship.profile.name}`}
                        className="composition-ship__main"
                        onClick={() => onSelectedShipChange(ship.instanceId)}
                        type="button"
                      >
                        <strong>{ship.profile.name}</strong>
                        <span>{ship.modelCount} мод.</span>
                        <small>
                          {[
                            ship.attachment ? `Attachments: ${ship.attachment}` : null,
                            ship.escortCount > 0 ? `Escort ×${ship.escortCount}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ") || "Базовая комплектация"}
                        </small>
                      </button>
                      <button
                        aria-label={`Удалить ${ship.profile.name}`}
                        className="composition-ship__remove"
                        onClick={() => removeShip(ship.instanceId)}
                        type="button"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {categoryShips.length < capacity ? (
                <button
                  className="composition-section__add"
                  onClick={() => onRequestCategory(category)}
                  type="button"
                >
                  <span aria-hidden="true">+</span>
                  Добавьте подходящий корабль
                </button>
              ) : null}
            </section>
          );
        })}
      </div>

      <aside className="ship-editor" aria-labelledby="editor-title">
        <div>
          <p className="eyebrow">В составе</p>
          <h2 id="editor-title">{selectedShip?.profile.name ?? "Настройки корабля"}</h2>
        </div>

        {selectedShip ? (
          <div className="ship-editor__form">
            <label>
              <span>Количество моделей</span>
              <input
                aria-label="Количество моделей"
                max="10"
                min="1"
                onChange={(event) => {
                  const nextCount = Number(event.target.value) || 1;
                  updateSelectedShip({ modelCount: Math.min(10, Math.max(1, nextCount)) });
                }}
                type="number"
                value={selectedShip.modelCount}
              />
            </label>
            <label>
              <span>Attachments</span>
              <select
                onChange={(event) => updateSelectedShip({ attachment: event.target.value })}
                value={selectedShip.attachment}
              >
                {attachments.map((attachment) => (
                  <option key={attachment || "none"} value={attachment}>
                    {attachment || "Без Attachments"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Escort</span>
              <input
                aria-label="Количество Escort"
                max="3"
                min="0"
                onChange={(event) => {
                  const nextCount = Number(event.target.value) || 0;
                  updateSelectedShip({ escortCount: Math.min(3, Math.max(0, nextCount)) });
                }}
                type="number"
                value={selectedShip.escortCount}
              />
            </label>
          </div>
        ) : (
          <div className="route-note">
            Нажмите на корабль в составе, чтобы открыть его настройки.
          </div>
        )}
      </aside>
    </div>
  );
}
