import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";

import { useDocumentTitle } from "../app/useDocumentTitle";
import { orbatTemplateFor } from "../app/orbatTemplates";
import {
  filterShipLibrary,
  listShipLibraryFactions,
  openShipLibrary,
  type ShipLibraryCatalog,
  type ShipLibraryDependencies,
  type ShipLibraryFaction,
  type ShipLibraryItem,
  type ShipLibrarySession,
} from "../application/ships/ship-library";
import { fleetCategories, type FleetCategory } from "../application/rosters/workspace";
import type { ShipEditorReadyReadModel } from "../application/rosters/ship-editor";
import { EyeIcon } from "../ui/EyeIcon";
import { FactionEmblem } from "../ui/FactionEmblem";
import { OrbatPageIcon } from "../ui/OrbatPageIcon";
import { ShipArtwork } from "../ui/ShipArtwork";
import { ShipOrbatPageDialog, ShipProfileDialog } from "../ui/ProfileDialog";
import { ShipCardProfile } from "../ui/ShipCardProfile";
import { StatePanel } from "../ui/StatePanel";

type FactionsState =
  | { readonly kind: "loading" }
  | { readonly kind: "error" }
  | { readonly kind: "ready"; readonly factions: readonly ShipLibraryFaction[] };

type CatalogState =
  | { readonly kind: "loading" }
  | { readonly kind: "missing" }
  | { readonly kind: "error" }
  | {
      readonly kind: "ready";
      readonly catalog: ShipLibraryCatalog;
      readonly session: ShipLibrarySession;
    };

export function ShipLibraryRoute({
  dependencies,
}: {
  readonly dependencies: ShipLibraryDependencies;
}) {
  const { factionId } = useParams();
  return factionId ? (
    <ShipCatalog factionId={factionId} dependencies={dependencies} />
  ) : (
    <FactionGallery dependencies={dependencies} />
  );
}

function FactionGallery({ dependencies }: { readonly dependencies: ShipLibraryDependencies }) {
  const [state, setState] = useState<FactionsState>({ kind: "loading" });
  useDocumentTitle("Корабли");

  useEffect(() => {
    let active = true;
    void listShipLibraryFactions(dependencies).then(
      (factions) => active && setState({ kind: "ready", factions }),
      () => active && setState({ kind: "error" }),
    );
    return () => {
      active = false;
    };
  }, [dependencies]);

  if (state.kind === "loading")
    return (
      <StatePanel
        state="loading"
        title="Открываем энциклопедию"
        description="Собираем список фракций и опубликованных кораблей."
      />
    );
  if (state.kind === "error")
    return (
      <StatePanel
        state="error"
        title="Энциклопедия недоступна"
        description="Не удалось прочитать опубликованный каталог кораблей."
      />
    );

  return (
    <div className="section-stack ship-library">
      <div className="ship-library__back-row">
        <Link className="text-action" to="/">
          ← Мои флоты
        </Link>
      </div>
      <header className="page-header ship-library__heading">
        <div>
          <p className="eyebrow">Энциклопедия кораблей</p>
          <h1>Выберите фракцию</h1>
        </div>
        <p className="page-lead">
          Характеристики, профили и все варианты вооружения из опубликованных ORBAT.
        </p>
      </header>
      <ul className="ship-faction-grid" aria-label="Фракции">
        {state.factions.map((faction) => {
          const template = orbatTemplateFor(faction.label);
          return (
            <li key={faction.id} style={{ "--faction-accent": template.accent } as CSSProperties}>
              <Link to={`/ships/${encodeURIComponent(faction.id)}`}>
                <FactionEmblem className="ship-faction-grid__emblem" faction={faction.label} />
                <span className="ship-faction-grid__name">{faction.label}</span>
                <span className="ship-faction-grid__count">{faction.shipCount} кораблей</span>
                <span className="ship-faction-grid__open">Открыть каталог →</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ShipCatalog({
  dependencies,
  factionId,
}: {
  readonly dependencies: ShipLibraryDependencies;
  readonly factionId: string;
}) {
  const [state, setState] = useState<CatalogState>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FleetCategory | "all">("all");
  const [priceOrder, setPriceOrder] = useState<"ascending" | "descending">("ascending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [profile, setProfile] = useState<{
    readonly item: ShipLibraryItem;
    readonly model: ShipEditorReadyReadModel;
  } | null>(null);
  const [orbat, setOrbat] = useState<ShipLibraryItem | null>(null);
  const title = state.kind === "ready" ? `Корабли ${state.session.faction.label}` : "Корабли";
  useDocumentTitle(title);

  useEffect(() => {
    let active = true;
    void openShipLibrary(factionId, dependencies).then(
      (catalog) =>
        active &&
        setState(
          catalog ? { kind: "ready", catalog, session: catalog.session } : { kind: "missing" },
        ),
      () => {
        if (active) setState({ kind: "error" });
      },
    );
    return () => {
      active = false;
    };
  }, [dependencies, factionId]);

  const ships = useMemo(
    () =>
      state.kind === "ready"
        ? filterShipLibrary(state.session.ships, query, category, priceOrder)
        : [],
    [category, priceOrder, query, state],
  );

  if (state.kind === "loading")
    return (
      <StatePanel
        state="loading"
        title="Загружаем корабли"
        description="Читаем профили и варианты вооружения выбранной фракции."
      />
    );
  if (state.kind === "missing")
    return (
      <StatePanel
        action={
          <Link className="button" to="/ships">
            К фракциям
          </Link>
        }
        state="empty"
        title="Фракция не найдена"
        description="В опубликованном каталоге нет такой фракции."
      />
    );
  if (state.kind === "error")
    return (
      <StatePanel
        action={
          <Link className="button" to="/ships">
            К фракциям
          </Link>
        }
        state="error"
        title="Каталог недоступен"
        description="Не удалось загрузить корабли выбранной фракции."
      />
    );

  return (
    <div className="section-stack ship-library ship-library--catalog">
      <div className="ship-library__back-row">
        <Link className="text-action" to="/ships">
          ← Все фракции
        </Link>
      </div>
      <header className="ship-catalog-heading">
        <FactionEmblem
          className="ship-catalog-heading__emblem"
          faction={state.session.faction.label}
        />
        <div>
          <p className="eyebrow">Энциклопедия кораблей</p>
          <h1>Корабли {state.session.faction.label}</h1>
        </div>
        <span className="badge">{state.session.faction.shipCount} кораблей</span>
        <Link className="button button--secondary ship-catalog-heading__return" to="/">
          Вернуться к моим флотам
        </Link>
      </header>

      <div className="ship-library-filters" aria-label="Фильтры кораблей">
        <label>
          <span>Поиск</span>
          <input
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Название корабля или тип"
            type="search"
            value={query}
          />
        </label>
        <label>
          <span>Тип корабля</span>
          <select
            onChange={(event) => setCategory(event.target.value as FleetCategory | "all")}
            value={category}
          >
            <option value="all">Все типы</option>
            {fleetCategories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Цена</span>
          <select
            onChange={(event) => setPriceOrder(event.target.value as "ascending" | "descending")}
            value={priceOrder}
          >
            <option value="ascending">Сначала дешевле</option>
            <option value="descending">Сначала дороже</option>
          </select>
        </label>
      </div>

      <div className="ship-library-results">
        <p role="status">
          Найдено: <strong>{ships.length}</strong>
        </p>
        <p>Профиль раскрывается в строке — без ухода со страницы</p>
      </div>

      {ships.length ? (
        <ul className="ship-library-table" aria-label="Корабли">
          {ships.map((ship) => {
            const expanded = expandedId === ship.id;
            const expandedProfile = expanded ? state.catalog.profile(ship.id) : null;
            return (
              <li data-expanded={expanded ? "true" : undefined} key={ship.id}>
                <div className="ship-library-row">
                  <ShipArtwork faction={state.session.faction.label} name={ship.name} />
                  <div className="ship-library-row__identity">
                    <h2>{ship.name}</h2>
                    <p>
                      {ship.category} · {ship.role}
                    </p>
                    <span>{ship.platform}</span>
                  </div>
                  <div className="ship-library-row__links" aria-label={`Ссылки ${ship.name}`}>
                    <button
                      aria-label={`Показать профиль ${ship.name}`}
                      onClick={() => {
                        const model = state.catalog.profile(ship.id);
                        if (model) setProfile({ item: ship, model });
                      }}
                      title="Наш профиль корабля"
                      type="button"
                    >
                      <EyeIcon />
                    </button>
                    <button
                      aria-label={`Показать страницу ORBAT ${ship.name}`}
                      onClick={() => setOrbat(ship)}
                      title="Вырезанная страница ORBAT"
                      type="button"
                    >
                      <OrbatPageIcon />
                    </button>
                  </div>
                  <div className="ship-library-row__price">
                    <strong>{ship.points}</strong>
                    <span>Points</span>
                    <small>{ship.victoryPoints} VPR</small>
                  </div>
                  <button
                    aria-expanded={expanded}
                    className="button button--secondary ship-library-row__toggle"
                    onClick={() => setExpandedId(expanded ? null : ship.id)}
                    type="button"
                  >
                    {expanded ? "Скрыть профиль ↑" : "Показать профиль ↓"}
                  </button>
                </div>
                {expandedProfile ? (
                  <div className="ship-library-row__profile">
                    <p className="eyebrow">Все вооружение и варианты хардпоинтов</p>
                    <div className="ship-library-row__profile-card">
                      <ShipProfileDialogContent
                        faction={state.session.faction.label}
                        model={expandedProfile}
                      />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <StatePanel
          state="empty"
          title="Корабли не найдены"
          description="Измените поисковый запрос или сбросьте фильтр типа."
        />
      )}

      {profile ? (
        <ShipProfileDialog
          faction={state.session.faction.label}
          model={profile.model}
          name={profile.item.name}
          onClose={() => setProfile(null)}
        />
      ) : null}
      {orbat ? (
        <ShipOrbatPageDialog
          imageUrl={orbat.orbatPageUrl}
          name={orbat.name}
          onClose={() => setOrbat(null)}
        />
      ) : null}
    </div>
  );
}

function ShipProfileDialogContent({
  faction,
  model,
}: {
  readonly faction: string;
  readonly model: ShipEditorReadyReadModel;
}) {
  return <ShipCardProfile faction={faction} model={model} />;
}
