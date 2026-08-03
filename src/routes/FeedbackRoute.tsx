import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";

import type {
  FeedbackGateway,
  FeedbackKind,
  FeedbackReceipt,
} from "../application/feedback/feedback-contract";
import {
  getHealth,
  type HealthGateway,
  type HealthResponse,
} from "../application/health/health-contract";
import { useDocumentTitle } from "../app/useDocumentTitle";

export function FeedbackRoute({
  feedbackGateway,
  healthGateway,
}: {
  feedbackGateway: FeedbackGateway;
  healthGateway: HealthGateway;
}) {
  useDocumentTitle("Обратная связь");
  const location = useLocation();
  const source = safeSource((location.state as { from?: unknown } | null)?.from);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [kind, setKind] = useState<FeedbackKind>("feedback");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<FeedbackReceipt | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getHealth(healthGateway, controller.signal).then(setHealth, () => undefined);
    return () => controller.abort();
  }, [healthGateway]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = message.trim();
    if (normalized.length < 10) {
      setError("Опишите вопрос хотя бы десятью символами.");
      setReceipt(null);
      return;
    }
    setBusy(true);
    setError("");
    setReceipt(null);
    try {
      const result = await feedbackGateway.submit({
        requestId,
        kind,
        message: normalized,
        email: email.trim(),
        source,
        appVersion: health?.appVersion ?? "unavailable",
        catalogVersion: health?.catalogVersion ?? "unavailable",
        commitSha: health?.commitSha ?? "unavailable",
      });
      setReceipt(result);
      setMessage("");
      setEmail("");
      setRequestId(crypto.randomUUID());
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Не удалось отправить обращение.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Связаться с проектом</p>
        <h1>Обратная связь</h1>
        <p className="page-lead">
          Сообщение попадёт в закрытую очередь проекта. Если хотите получить ответ, оставьте email.
        </p>
      </div>

      <form className="panel feedback-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid">
          <label className="form-field form-field--wide">
            Тип обращения
            <select onChange={(event) => setKind(event.target.value as FeedbackKind)} value={kind}>
              <option value="feedback">Отзыв</option>
              <option value="bug">Ошибка</option>
              <option value="idea">Предложение</option>
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
          <label className="form-field form-field--wide">
            Email <span className="field-optional">необязательно</span>
            <input
              aria-describedby="feedback-email-note"
              autoComplete="email"
              inputMode="email"
              maxLength={254}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="admiral@example.com"
              type="email"
              value={email}
            />
            <small id="feedback-email-note">
              Добавим адрес в Jira-задачу, чтобы связаться с вами после исправления.
            </small>
          </label>
        </div>
        {error ? (
          <p className="form-submit-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="button-row">
          <button className="button" disabled={busy} type="submit">
            {busy ? "Отправляем…" : "Отправить обращение"}
          </button>
        </div>
      </form>

      {receipt ? (
        <section className="feedback-preview" aria-live="polite">
          <strong>Обращение принято</strong>
          <p>
            Спасибо. Номер обращения: <code>{receipt.id}</code>.
          </p>
        </section>
      ) : null}

      <p className="panel__copy">
        Форма не читает localStorage и не прикладывает состав флота или другие данные браузера.
      </p>
    </div>
  );
}

function safeSource(value: unknown): string {
  return typeof value === "string" && value.length <= 80 ? value : "unknown";
}
