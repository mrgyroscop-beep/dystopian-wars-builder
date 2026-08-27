import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";

import { useDocumentTitle } from "../app/useDocumentTitle";
import {
  FleetCompositionEditor,
  sectionCapacity,
  type FleetShip,
} from "../ui/orbat/FleetCompositionEditor";
import { OrbatProfileBrowser } from "../ui/orbat/OrbatProfileBrowser";
import type { OrbatProfile, OrbatProfileCategory } from "../ui/orbat/orbatProfiles";

const rosterIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);

export function RosterWorkspaceRoute() {
  useDocumentTitle("Билдер флота");
  const params = useParams();
  const parsedRosterId = rosterIdSchema.safeParse(params.rosterId);
  const [catalogCategory, setCatalogCategory] = useState<OrbatProfileCategory | "all">("all");
  const [ships, setShips] = useState<readonly FleetShip[]>([]);
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  const addShip = (profile: OrbatProfile) => {
    if (
      ships.filter((ship) => ship.profile.category === profile.category).length >=
      sectionCapacity[profile.category]
    ) {
      return;
    }

    const instanceId = `${profile.id}-${crypto.randomUUID()}`;
    setShips((currentShips) => [
      ...currentShips,
      { attachment: "", escortCount: 0, instanceId, modelCount: 1, profile },
    ]);
    setSelectedShipId(instanceId);
  };

  if (!parsedRosterId.success) {
    return (
      <div className="section-stack">
        <div className="page-header">
          <p className="eyebrow">Некорректная ссылка</p>
          <h1>Флот не найден</h1>
          <p className="page-lead">Идентификатор в адресе не соответствует безопасному формату.</p>
        </div>
        <Link className="button" to="/">
          К библиотеке
        </Link>
      </div>
    );
  }

  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Empire · Fleet Builder</p>
        <h1>Черновик флота</h1>
        <p className="page-lead">
          Добавляйте корабли из каталога и настраивайте их прямо в составе. Идентификатор:{" "}
          <code>{parsedRosterId.data}</code>.
        </p>
      </div>

      <dl className="workspace-summary" aria-label="Сводка флота">
        <div className="summary-item">
          <dt>Points</dt>
          <dd>— / 1 000</dd>
        </div>
        <div className="summary-item">
          <dt>Моделей</dt>
          <dd>{ships.reduce((total, ship) => total + ship.modelCount, 0)}</dd>
        </div>
        <div className="summary-item">
          <dt>Состояние</dt>
          <dd>{ships.length > 0 ? `${ships.length} позиций` : "Нужен состав"}</dd>
        </div>
        <div className="summary-item">
          <dt>Сохранение</dt>
          <dd>Черновик</dd>
        </div>
      </dl>

      <div className="workspace-grid">
        <section className="panel workspace-column" aria-labelledby="catalog-title">
          <div>
            <p className="eyebrow">Область 1</p>
            <h2 id="catalog-title">Каталог</h2>
          </div>
          <p className="panel__copy">
            Нажмите на название для просмотра профиля или на плюс, чтобы добавить корабль.
          </p>
          <OrbatProfileBrowser
            category={catalogCategory}
            onAdd={addShip}
            onCategoryChange={setCatalogCategory}
          />
        </section>

        <section
          className="panel workspace-column workspace-column--builder"
          aria-labelledby="composition-title"
        >
          <div>
            <p className="eyebrow">Главная область</p>
            <h2 id="composition-title">Состав</h2>
          </div>
          <FleetCompositionEditor
            onRequestCategory={(category) => setCatalogCategory(category)}
            onSelectedShipChange={setSelectedShipId}
            onShipsChange={setShips}
            selectedShipId={selectedShipId}
            ships={ships}
          />
        </section>
      </div>
    </div>
  );
}
