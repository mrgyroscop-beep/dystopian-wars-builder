import { Link, isRouteErrorResponse, useRouteError } from "react-router-dom";

export function RouteErrorBoundary() {
  const error = useRouteError();
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "Неизвестная ошибка маршрута.";

  return (
    <main className="main-content" id="main-content">
      <div className="section-stack">
        <div className="page-header">
          <p className="eyebrow">Ошибка приложения</p>
          <h1>Не удалось открыть экран</h1>
          <p className="page-lead">Локальные данные не изменены. {detail}</p>
        </div>
        <Link className="button" to="/">
          Вернуться к флотам
        </Link>
      </div>
    </main>
  );
}
