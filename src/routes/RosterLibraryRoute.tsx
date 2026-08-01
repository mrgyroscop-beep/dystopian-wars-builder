import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { useDocumentTitle } from "../app/useDocumentTitle";
import { fixtureStates, StatePanel, type FixtureState } from "../ui/StatePanel";

const fixtureStateSchema = z.enum(fixtureStates).catch("empty");

const fixtureContent: Record<FixtureState, { title: string; description: string }> = {
  loading: {
    title: "Загружаем флоты",
    description: "Проверяем локальные данные. Уже сохранённая работа не изменяется.",
  },
  empty: {
    title: "Флотов пока нет",
    description: "Создание и импорт появятся в следующих задачах. Каркас уже готов к маршрутам.",
  },
  error: {
    title: "Не удалось открыть библиотеку",
    description: "Данные на устройстве сохранены. Повторите попытку или откройте настройки.",
  },
  success: {
    title: "Локальные данные готовы",
    description: "Каркас успешно прочитал состояние библиотеки и может продолжить работу.",
  },
};

export function RosterLibraryRoute() {
  useDocumentTitle("Флоты");
  const [searchParams] = useSearchParams();
  const fixture = fixtureStateSchema.parse(searchParams.get("state") ?? "empty");
  const content = fixtureContent[fixture];

  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Локальная библиотека</p>
        <h1>Мои флоты</h1>
        <p className="page-lead">
          Нейтральная оболочка будущего билдера. На этом этапе она проверяет маршрутизацию,
          системные состояния и адаптивность — без игровых данных и авторизации.
        </p>
      </div>

      <section className="panel panel--quiet" aria-labelledby="fixture-title">
        <div className="panel__header">
          <div>
            <h2 id="fixture-title">Состояния каркаса</h2>
            <p className="panel__copy">
              Query-параметр позволяет воспроизводимо проверить loading, empty, error и success.
            </p>
          </div>
          <span className="badge">Fixture: {fixture}</span>
        </div>

        <nav className="fixture-switcher" aria-label="Выбор тестового состояния">
          {fixtureStates.map((state) => (
            <Link
              aria-current={fixture === state ? "page" : undefined}
              className="text-action"
              key={state}
              to={`/?state=${state}`}
            >
              {state}
            </Link>
          ))}
        </nav>

        <StatePanel
          action={
            fixture === "empty" ? (
              <Link className="button" to="/rosters/new">
                Создать флот
              </Link>
            ) : fixture === "error" ? (
              <Link className="button" to="/?state=loading">
                Повторить
              </Link>
            ) : undefined
          }
          description={content.description}
          state={fixture}
          title={content.title}
        />
      </section>
    </div>
  );
}
