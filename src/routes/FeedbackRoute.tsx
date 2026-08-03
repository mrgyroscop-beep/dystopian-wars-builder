import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";

import {
  getHealth,
  type HealthGateway,
  type HealthResponse,
} from "../application/health/health-contract";
import { useDocumentTitle } from "../app/useDocumentTitle";

const newIssueUrl = "https://github.com/mrgyroscop-beep/dystopian-wars-builder/issues/new";

export function FeedbackRoute({ healthGateway }: { healthGateway: HealthGateway }) {
  useDocumentTitle("Обратная связь");
  const location = useLocation();
  const source = safeSource((location.state as { from?: unknown } | null)?.from);
  const [kind, setKind] = useState("Отзыв");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [preparedUrl, setPreparedUrl] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getHealth(healthGateway, controller.signal).then(setHealth, () => undefined);
    return () => controller.abort();
  }, [healthGateway]);

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = message.trim();
    if (normalized.length < 10) {
      setError("Опишите вопрос хотя бы десятью символами.");
      setPreparedUrl(null);
      return;
    }
    setError("");
    const target = new URL(newIssueUrl);
    target.searchParams.set("title", `${kind}: ${normalized.slice(0, 80)}`);
    target.searchParams.set(
      "body",
      [
        `## ${kind}`,
        "",
        normalized,
        "",
        "## Безопасный контекст",
        "",
        `- Экран: ${source}`,
        `- Версия приложения: ${health?.appVersion ?? "недоступна"}`,
        `- Версия каталога: ${health?.catalogVersion ?? "недоступна"}`,
        `- Commit: ${health?.commitSha ?? "недоступен"}`,
        "",
        "Состав флота и данные браузера не приложены.",
      ].join("\n"),
    );
    setPreparedUrl(target.toString());
  }

  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Связаться с проектом</p>
        <h1>Обратная связь</h1>
        <p className="page-lead">
          Мы подготовим черновик GitHub-обращения. Вы увидите его целиком и отправите
          самостоятельно.
        </p>
      </div>

      <form className="panel feedback-form" onSubmit={prepare}>
        <div className="form-grid">
          <label className="form-field form-field--wide">
            Тип обращения
            <select onChange={(event) => setKind(event.target.value)} value={kind}>
              <option>Отзыв</option>
              <option>Ошибка</option>
              <option>Предложение</option>
            </select>
          </label>
          <label className="form-field form-field--wide">
            Сообщение
            <textarea
              maxLength={4000}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Что произошло или что хотелось бы улучшить?"
              required
              value={message}
            />
          </label>
        </div>
        {error ? (
          <p className="form-submit-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="button-row">
          <button className="button" type="submit">
            Подготовить обращение
          </button>
        </div>
      </form>

      {preparedUrl ? (
        <section className="feedback-preview" aria-live="polite">
          <strong>Черновик готов</strong>
          <p>
            GitHub откроет заполненную форму. Проверьте текст и нажмите Submit только если всё
            верно.
          </p>
          <a className="button" href={preparedUrl} rel="noreferrer" target="_blank">
            Открыть и проверить
          </a>
        </section>
      ) : null}

      <p className="panel__copy">
        Форма не читает localStorage, не прикладывает состав флота и ничего не отправляет
        автоматически.
      </p>
    </div>
  );
}

function safeSource(value: unknown): string {
  return typeof value === "string" && value.length <= 80 ? value : "unknown";
}
