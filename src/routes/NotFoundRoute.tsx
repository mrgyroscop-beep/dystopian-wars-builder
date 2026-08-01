import { Link, useLocation } from "react-router-dom";

import { useDocumentTitle } from "../app/useDocumentTitle";

export function NotFoundRoute() {
  useDocumentTitle("Страница не найдена");
  const location = useLocation();

  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Ошибка 404</p>
        <h1>Такого маршрута нет</h1>
        <p className="page-lead">
          Путь <code>{location.pathname}</code> не относится к каркасу приложения. Можно безопасно
          вернуться к библиотеке.
        </p>
      </div>
      <div className="button-row">
        <Link className="button" to="/">
          К моим флотам
        </Link>
        <Link className="button button--secondary" to="/settings">
          Проверить настройки
        </Link>
      </div>
    </div>
  );
}
