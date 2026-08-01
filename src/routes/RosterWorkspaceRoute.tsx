import { Link, useParams } from "react-router-dom";
import { z } from "zod";

import { useDocumentTitle } from "../app/useDocumentTitle";

const rosterIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);

export function RosterWorkspaceRoute() {
  useDocumentTitle("Оболочка билдера");
  const params = useParams();
  const parsedRosterId = rosterIdSchema.safeParse(params.rosterId);

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
        <p className="eyebrow">Демонстрационный маршрут</p>
        <h1>Черновик флота</h1>
        <p className="page-lead">
          Три архитектурные области показывают будущую композицию, но не содержат игровой логики.
          Идентификатор: <code>{parsedRosterId.data}</code>.
        </p>
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
            <p>После импорта данных здесь будут обязательные и доступные элементы.</p>
          </div>
        </section>

        <aside className="panel workspace-column" aria-labelledby="editor-title">
          <div>
            <p className="eyebrow">Область 3</p>
            <h2 id="editor-title">Редактор</h2>
          </div>
          <p className="panel__copy">
            Настройка, профиль и правила откроются после выбора корабля в KAN-35—36.
          </p>
          <div className="route-note">Выберите корабль в составе, чтобы увидеть его контекст.</div>
        </aside>
      </div>
    </div>
  );
}
