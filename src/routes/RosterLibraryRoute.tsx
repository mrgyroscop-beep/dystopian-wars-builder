import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { orbatTemplateFor } from "../app/orbatTemplates";
import { useDocumentTitle } from "../app/useDocumentTitle";
import type { StoredRoster } from "../application/rosters/create-roster";
import {
  deleteRoster,
  duplicateRoster,
  exportRoster,
  importRoster,
  renameRoster,
  type RosterLibraryDependencies,
} from "../application/rosters/roster-library";
import { EyeIcon } from "../ui/EyeIcon";
import { fixtureStates, StatePanel, type FixtureState } from "../ui/StatePanel";

const fixtureStateSchema = z.enum(fixtureStates);
type LibraryState =
  | { readonly kind: "loading" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "ready"; readonly rosters: readonly StoredRoster[] };

export function RosterLibraryRoute({ dependencies }: { dependencies: RosterLibraryDependencies }) {
  useDocumentTitle("Флоты");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const requestedFixture = fixtureStateSchema.safeParse(searchParams.get("state"));
  const fixture = import.meta.env.DEV && requestedFixture.success ? requestedFixture.data : null;
  const [state, setState] = useState<LibraryState>({ kind: "loading" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [message, setMessage] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (fixture) return;
    try {
      setState({ kind: "ready", rosters: await dependencies.rosterRepository.list() });
    } catch {
      setState({ kind: "error", message: "Не удалось прочитать локальную библиотеку." });
    }
  }, [dependencies, fixture]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  async function saveName(roster: StoredRoster) {
    try {
      await renameRoster(roster, draftName, dependencies);
      setEditingId(null);
      setMessage("Название сохранено.");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось переименовать флот.");
    }
  }

  async function copy(roster: StoredRoster) {
    try {
      const created = await duplicateRoster(roster, dependencies);
      setMessage("Копия создана.");
      await refresh();
      void navigate(`/rosters/${created.id}`);
    } catch {
      setMessage("Не удалось создать копию.");
    }
  }

  async function remove(roster: StoredRoster) {
    try {
      await deleteRoster(roster, dependencies);
      setDeletingId(null);
      setMessage("Флот удалён.");
      await refresh();
    } catch {
      setMessage("Не удалось удалить флот.");
    }
  }

  function download(roster: StoredRoster) {
    const blob = new Blob([exportRoster(roster)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileName(roster.name)}.dwb.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("Файл экспорта подготовлен.");
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const roster = await importRoster(await file.text(), dependencies);
      setMessage("Флот импортирован как новая локальная копия.");
      void navigate(`/rosters/${roster.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось импортировать файл.");
    }
  }

  if (fixture) return <FixtureLibrary state={fixture} />;

  return (
    <div className="section-stack roster-library">
      <div className="page-header roster-library__header">
        <div>
          <p className="eyebrow">Локальная библиотека</p>
          <h1>Мои флоты</h1>
          <p className="page-lead">
            Флоты сохраняются на этом устройстве и доступны без регистрации.
          </p>
        </div>
        <div className="roster-library__primary-actions">
          <Link className="button" to="/rosters/new">
            Создать флот
          </Link>
          <Link className="button button--secondary roster-library__ships" to="/ships">
            <EyeIcon />
            Просмотреть корабли
          </Link>
          <button
            className="button button--secondary"
            onClick={() => importInput.current?.click()}
            type="button"
          >
            Импортировать
          </button>
          <input
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => void importFile(event)}
            ref={importInput}
            type="file"
          />
        </div>
      </div>

      <p aria-live="polite" className={message ? "system-message" : "sr-only"}>
        {message}
      </p>

      {state.kind === "loading" ? (
        <StatePanel
          state="loading"
          title="Загружаем флоты"
          description="Читаем сохранения на этом устройстве."
        />
      ) : state.kind === "error" ? (
        <StatePanel
          action={
            <button
              className="button"
              onClick={() => {
                setState({ kind: "loading" });
                void refresh();
              }}
              type="button"
            >
              Повторить
            </button>
          }
          state="error"
          title="Не удалось открыть библиотеку"
          description={state.message}
        />
      ) : state.rosters.length === 0 ? (
        <StatePanel
          action={
            <Link className="button" to="/rosters/new">
              Создать первый флот
            </Link>
          }
          state="empty"
          title="Флотов пока нет"
          description="Создайте новый флот или импортируйте ранее сохранённый JSON-файл."
        />
      ) : (
        <ul className="roster-card-list" aria-label="Сохранённые флоты">
          {state.rosters.map((roster) => (
            <li className="roster-card" key={roster.id}>
              <div className="roster-card__identity">
                <FactionEmblem faction={roster.faction.label} />
                <div className="roster-card__summary">
                  {editingId === roster.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveName(roster);
                      }}
                    >
                      <label htmlFor={`rename-${roster.id}`}>Название флота</label>
                      <div className="roster-card__rename">
                        <input
                          id={`rename-${roster.id}`}
                          maxLength={80}
                          onChange={(event) => setDraftName(event.target.value)}
                          value={draftName}
                        />
                        <button className="button" type="submit">
                          Сохранить
                        </button>
                        <button
                          className="button button--secondary"
                          onClick={() => setEditingId(null)}
                          type="button"
                        >
                          Отмена
                        </button>
                      </div>
                    </form>
                  ) : (
                    <h2>
                      <Link to={`/rosters/${roster.id}`}>{roster.name}</Link>
                    </h2>
                  )}
                  <p>
                    {roster.faction.label} · {roster.battlefleet.label}
                  </p>
                  <p>{roster.limits.points} Points</p>
                  <p className="muted">Сохранено на устройстве · {formatDate(roster.updatedAt)}</p>
                </div>
              </div>
              <div className="roster-card__actions">
                <Link className="button" to={`/rosters/${roster.id}`}>
                  Открыть
                </Link>
                <button
                  className="button button--secondary"
                  onClick={() => {
                    setEditingId(roster.id);
                    setDraftName(roster.name);
                  }}
                  type="button"
                >
                  Переименовать
                </button>
                <button
                  className="button button--secondary"
                  onClick={() => void copy(roster)}
                  type="button"
                >
                  Копировать
                </button>
                <button
                  className="button button--secondary"
                  onClick={() => download(roster)}
                  type="button"
                >
                  Экспорт
                </button>
                {deletingId === roster.id ? (
                  <>
                    <button
                      className="button button--danger"
                      onClick={() => void remove(roster)}
                      type="button"
                    >
                      Удалить флот
                    </button>
                    <button
                      className="button button--secondary"
                      onClick={() => setDeletingId(null)}
                      type="button"
                    >
                      Отмена
                    </button>
                  </>
                ) : (
                  <button
                    className="button button--danger"
                    onClick={() => setDeletingId(roster.id)}
                    type="button"
                  >
                    Удалить
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FactionEmblem({ faction }: { faction: string }) {
  const template = orbatTemplateFor(faction);
  return (
    <span
      aria-hidden="true"
      className="roster-card__faction-emblem"
      style={{ backgroundImage: `url(${template.imageUrl})`, borderColor: template.accent }}
    />
  );
}

function FixtureLibrary({ state }: { state: FixtureState }) {
  const fixtureContent: Record<FixtureState, readonly [string, string]> = {
    loading: [
      "Загружаем флоты",
      "Проверяем локальные данные. Уже сохранённая работа не изменяется.",
    ],
    empty: ["Флотов пока нет", "Создайте первый локальный флот."],
    error: ["Не удалось открыть библиотеку", "Данные на устройстве сохранены."],
    success: ["Локальные данные готовы", "Библиотека успешно прочитана."],
  };
  const content = fixtureContent[state];
  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Локальная библиотека</p>
        <h1>Мои флоты</h1>
      </div>
      <StatePanel
        action={
          state === "empty" ? (
            <Link className="button" to="/rosters/new">
              Создать флот
            </Link>
          ) : undefined
        }
        description={content[1]}
        state={state}
        title={content[0]}
      />
    </div>
  );
}

function fileName(value: string): string {
  return (
    value
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "fleet"
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
