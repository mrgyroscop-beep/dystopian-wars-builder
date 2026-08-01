import { Link } from "react-router-dom";

import { useDocumentTitle } from "../app/useDocumentTitle";

export function NewRosterRoute() {
  useDocumentTitle("Создание флота");

  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Маршрут готов</p>
        <h1>Новый флот</h1>
        <p className="page-lead">
          Здесь появится последовательный выбор фракции, лимитов и Battlefleet. Функциональная форма
          относится к KAN-33.
        </p>
      </div>

      <section className="panel" aria-labelledby="creation-seam-title">
        <div className="panel__header">
          <div>
            <h2 id="creation-seam-title">Контракт следующего этапа</h2>
            <p className="panel__copy">Обязательные решения будут видимы до создания состава.</p>
          </div>
          <span className="badge">KAN-33</span>
        </div>
        <ol className="placeholder-list">
          <li>Фракция и версия каталога</li>
          <li>Лимиты Points и VP</li>
          <li>Battlefleet и его особенности</li>
          <li>Название и локальное сохранение</li>
        </ol>
      </section>

      <div className="button-row">
        <Link className="button button--secondary" to="/">
          Вернуться к флотам
        </Link>
        <Link className="button" to="/rosters/scaffold-demo">
          Открыть оболочку билдера
        </Link>
      </div>
    </div>
  );
}
