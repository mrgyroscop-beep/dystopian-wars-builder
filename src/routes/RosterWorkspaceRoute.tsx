import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { z } from "zod";

import type { RosterRepository, StoredRoster } from "../application/rosters/create-roster";
import { useDocumentTitle } from "../app/useDocumentTitle";

const rosterIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/u);

type RosterState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly roster: StoredRoster }
  | { readonly kind: "missing"; readonly id: string };

export function RosterWorkspaceRoute({
  rosterRepository,
}: {
  readonly rosterRepository: RosterRepository;
}) {
  const params = useParams();
  const parsedRosterId = rosterIdSchema.safeParse(params.rosterId);
  const rosterId =
    parsedRosterId.success && parsedRosterId.data !== "scaffold-demo" ? parsedRosterId.data : null;
  const [state, setState] = useState<RosterState>({ kind: "loading" });
  const title = state.kind === "ready" ? state.roster.name : "Состав флота";
  useDocumentTitle(title);

  useEffect(() => {
    let active = true;
    if (!rosterId) return () => undefined;
    void rosterRepository.read(rosterId).then(
      (roster) => {
        if (active)
          setState(roster ? { kind: "ready", roster } : { kind: "missing", id: rosterId });
      },
      () => {
        if (active) setState({ kind: "missing", id: rosterId });
      },
    );
    return () => {
      active = false;
    };
  }, [rosterId, rosterRepository]);

  if (!parsedRosterId.success) return <InvalidRoster />;
  if (parsedRosterId.data === "scaffold-demo") return <ScaffoldWorkspace />;
  if (
    state.kind === "loading" ||
    (state.kind === "ready" && state.roster.id !== rosterId) ||
    (state.kind === "missing" && state.id !== rosterId)
  ) {
    return (
      <div className="section-stack">
        <div className="page-header">
          <p className="eyebrow">Локальный состав</p>
          <h1>Открываем флот</h1>
          <p className="page-lead" role="status">
            Читаем сохранённый черновик на этом устройстве…
          </p>
        </div>
      </div>
    );
  }
  if (state.kind === "missing") return <InvalidRoster />;

  const { roster } = state;
  return (
    <div className="section-stack">
      <div className="page-header workspace-heading">
        <p className="eyebrow">
          {roster.faction.label} · {roster.battlefleet.label}
        </p>
        <h1>{roster.name}</h1>
        <p className="page-lead">
          Основа сохранена локально. Добавление кораблей появится на следующем этапе; обязательный
          каркас уже виден и не потеряется после обновления страницы.
        </p>
      </div>

      <dl className="workspace-summary" aria-label="Сводка флота">
        <div className="summary-item">
          <dt>Points</dt>
          <dd>0 / {roster.limits.points}</dd>
        </div>
        <div className="summary-item">
          <dt>VP</dt>
          <dd>0 / {roster.limits.victoryPoints}</dd>
        </div>
        <div className="summary-item">
          <dt>Состояние</dt>
          <dd>Нужен состав</dd>
        </div>
        <div className="summary-item">
          <dt>Сохранение</dt>
          <dd className="saved-value">Локально ✓</dd>
        </div>
      </dl>

      <div className="workspace-grid">
        <section className="panel workspace-column" aria-labelledby="catalog-title">
          <div>
            <p className="eyebrow">Battlefleet</p>
            <h2 id="catalog-title">{roster.battlefleet.label}</h2>
          </div>
          <p className="panel__copy">Каталог кораблей и фильтры появятся в KAN-34.</p>
          <Link className="button button--secondary" to="/rosters/new">
            Создать другой флот
          </Link>
        </section>

        <section className="panel workspace-column" aria-labelledby="composition-title">
          <div>
            <p className="eyebrow">Пустой состав</p>
            <h2 id="composition-title">Обязательные элементы</h2>
          </div>
          {roster.requiredElements.length ? (
            <ul className="required-composition">
              {roster.requiredElements.map((element) => (
                <li key={element.id}>
                  <span className="required-composition__signal" aria-hidden="true" />
                  <span>
                    <strong>{element.label}</strong>
                    <small>Нужно добавить в состав</small>
                  </span>
                  <b>×{element.minimum}</b>
                </li>
              ))}
            </ul>
          ) : (
            <div className="state-panel" data-state="empty">
              <span className="state-panel__symbol" aria-hidden="true">
                ○
              </span>
              <h3>Обязательных элементов нет</h3>
              <p>Состав готов к добавлению кораблей.</p>
            </div>
          )}
        </section>

        <aside className="panel workspace-column" aria-labelledby="editor-title">
          <div>
            <p className="eyebrow">Готовность</p>
            <h2 id="editor-title">Следующий шаг</h2>
          </div>
          <p className="panel__copy">
            Добавьте корабли в обязательные элементы, когда станет доступен каталог KAN-34.
          </p>
          <div className="route-note">
            Черновик: <code>{roster.id}</code>
          </div>
        </aside>
      </div>
    </div>
  );
}

function InvalidRoster() {
  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Некорректная ссылка</p>
        <h1>Флот не найден</h1>
        <p className="page-lead">В локальном хранилище нет подходящего черновика.</p>
      </div>
      <Link className="button" to="/">
        К библиотеке
      </Link>
    </div>
  );
}

function ScaffoldWorkspace() {
  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Демонстрационный маршрут</p>
        <h1>Черновик флота</h1>
        <p className="page-lead">Три области показывают будущую композицию билдера.</p>
      </div>
      <dl className="workspace-summary" aria-label="Сводка флота">
        <div className="summary-item">
          <dt>Points</dt>
          <dd>0 / 1 000</dd>
        </div>
        <div className="summary-item">
          <dt>VP</dt>
          <dd>0</dd>
        </div>
        <div className="summary-item">
          <dt>Состояние</dt>
          <dd>Нужен состав</dd>
        </div>
        <div className="summary-item">
          <dt>Сохранение</dt>
          <dd>Только fixture</dd>
        </div>
      </dl>
      <div className="workspace-grid">
        <section className="panel workspace-column" aria-labelledby="catalog-title">
          <div>
            <p className="eyebrow">Область 1</p>
            <h2 id="catalog-title">Каталог</h2>
          </div>
          <p className="panel__copy">Поиск, фильтры и доступные корабли появятся в KAN-34.</p>
          <ul className="placeholder-list">
            <li>Flagship</li>
            <li>Line</li>
            <li>Support</li>
          </ul>
        </section>
        <section className="panel workspace-column" aria-labelledby="composition-title">
          <div>
            <p className="eyebrow">Главная область</p>
            <h2 id="composition-title">Состав</h2>
          </div>
          <div className="state-panel" data-state="empty">
            <span className="state-panel__symbol" aria-hidden="true">
              ○
            </span>
            <h3>Battlefleet Elements пусты</h3>
            <p>Создайте флот, чтобы увидеть обязательные элементы.</p>
          </div>
        </section>
        <aside className="panel workspace-column" aria-labelledby="editor-title">
          <div>
            <p className="eyebrow">Область 3</p>
            <h2 id="editor-title">Редактор</h2>
          </div>
          <p className="panel__copy">Настройка корабля появится в KAN-35—36.</p>
        </aside>
      </div>
    </div>
  );
}
