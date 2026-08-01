import { useEffect, useState } from "react";

import { getHealth, type HealthResponse } from "../application/health/health-contract";
import { useDocumentTitle } from "../app/useDocumentTitle";
import { createHttpHealthGateway } from "../infrastructure/health/http-health-gateway";

type HealthState =
  | { kind: "loading" }
  | { kind: "success"; data: HealthResponse }
  | { kind: "error"; message: string };

export function SettingsRoute() {
  useDocumentTitle("Настройки");
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    const gateway = createHttpHealthGateway();

    getHealth(gateway, controller.signal).then(
      (data) => setHealth({ kind: "success", data }),
      (error: unknown) => {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : "Неизвестная ошибка API.";
          setHealth({ kind: "error", message });
        }
      },
    );

    return () => controller.abort();
  }, []);

  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Системная информация</p>
        <h1>Настройки</h1>
        <p className="page-lead">
          Здесь проверяется единый origin: React запрашивает Worker API через относительный путь.
        </p>
      </div>

      <section className="panel" aria-labelledby="health-title">
        <div className="panel__header">
          <div>
            <h2 id="health-title">Состояние приложения</h2>
            <p className="panel__copy">Ответ валидируется Zod на границе HTTP.</p>
          </div>
          <span className="badge">GET /api/health</span>
        </div>

        {health.kind === "loading" ? (
          <p className="status-line" role="status" aria-busy="true">
            Проверяем Worker API…
          </p>
        ) : health.kind === "error" ? (
          <div className="status-line status-line--error" role="alert">
            <span>
              API недоступен. <small>{health.message}</small>
            </span>
          </div>
        ) : (
          <dl className="definition-list">
            <dt>Worker API</dt>
            <dd className="status-line">Доступен</dd>
            <dt>Версия приложения</dt>
            <dd>{health.data.appVersion}</dd>
            <dt>Версия каталога</dt>
            <dd>{health.data.catalogVersion}</dd>
          </dl>
        )}
      </section>

      <section className="panel panel--quiet" aria-labelledby="boundaries-title">
        <h2 id="boundaries-title">Границы этапа</h2>
        <p className="panel__copy">
          D1, авторизация, секреты, production identifiers и реальные игровые данные не настроены.
        </p>
      </section>
    </div>
  );
}
