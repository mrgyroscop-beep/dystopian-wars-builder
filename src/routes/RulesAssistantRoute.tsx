import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";

import type { AuthGateway, AuthUser } from "../application/auth/auth-contract";
import type {
  AssistantMessage,
  AssistantResponse,
  RulesAssistantGateway,
} from "../application/assistant/rules-assistant-contract";

const suggestions = [
  "Как работает правило All-Around?",
  "Что даёт свойство Ablative Armour?",
  "Когда модель может использовать Escorts?",
];

interface ChatEntry extends AssistantMessage {
  sources?: AssistantResponse["sources"];
}

export function RulesAssistantPanel({
  authGateway,
  assistantGateway,
}: {
  authGateway: AuthGateway;
  assistantGateway: RulesAssistantGateway;
}) {
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [question, setQuestion] = useState("");
  const [conversation, setConversation] = useState<ChatEntry[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    authGateway.session(controller.signal).then(setUser, () => setUser(null));
    return () => controller.abort();
  }, [authGateway]);

  const latestSources = useMemo(
    () => [...conversation].reverse().find((entry) => entry.sources)?.sources ?? [],
    [conversation],
  );

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = question.trim();
    if (normalized.length < 3 || busy) return;
    const history = conversation.slice(-6).map(({ role, content }) => ({ role, content }));
    setConversation((current) => [...current, { role: "user", content: normalized }]);
    setQuestion("");
    setBusy(true);
    setError("");
    try {
      const response = await assistantGateway.ask(normalized, history);
      setConversation((current) => [
        ...current,
        { role: "assistant", content: response.answer, sources: response.sources },
      ]);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "Старпом сейчас не отвечает.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section-stack assistant-page assistant-page--embedded">
      <header className="assistant-page__header">
        <p className="eyebrow">Помощник адмирала</p>
        <h2>Старпом</h2>
        <p className="page-lead">
          Задайте вопрос по Dystopian Wars 4.0. Ответ строится по опубликованному каталогу правил и
          содержит ссылки на использованные выдержки.
        </p>
      </header>

      {user === undefined ? <p className="panel__copy">Проверяем вахтенный журнал…</p> : null}
      {user === null ? (
        <section className="panel assistant-login">
          <p className="eyebrow">Требуется аккаунт</p>
          <h2>Представьтесь перед вопросом</h2>
          <p>Вход защищает сервис от автоматических запросов и сохраняет доступ бесплатным.</p>
          <Link className="button" to="/settings#account-title">
            Войти или создать аккаунт
          </Link>
        </section>
      ) : null}
      {user ? (
        <div className="assistant-layout">
          <section className="panel assistant-chat" aria-label="Разговор со Старпомом">
            <div className="assistant-chat__log" aria-live="polite">
              {conversation.length === 0 ? (
                <div className="assistant-empty">
                  <span aria-hidden="true">⚓</span>
                  <h2>Чем помочь, адмирал {user.displayName}?</h2>
                  <p>Лучше всего задавать один конкретный вопрос о правиле или свойстве модели.</p>
                  <div className="assistant-suggestions">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => setQuestion(suggestion)}
                        type="button"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                conversation.map((entry, index) => (
                  <article
                    className={`assistant-message assistant-message--${entry.role}`}
                    key={index}
                  >
                    <strong>{entry.role === "user" ? "Вы" : "Старпом"}</strong>
                    <p>{entry.content}</p>
                  </article>
                ))
              )}
              {busy ? <p className="assistant-thinking">Старпом сверяется с журналами…</p> : null}
            </div>
            <form className="assistant-composer" onSubmit={(event) => void ask(event)}>
              <label htmlFor="assistant-question">Ваш вопрос</label>
              <div>
                <textarea
                  id="assistant-question"
                  maxLength={800}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Например: как работает правило All-Around?"
                  rows={3}
                  value={question}
                />
                <button
                  className="button"
                  disabled={busy || question.trim().length < 3}
                  type="submit"
                >
                  Спросить
                </button>
              </div>
              {error ? (
                <p className="form-submit-error" role="alert">
                  {error}
                </p>
              ) : null}
              <small>
                До 20 вопросов в час. Ответ помощника стоит сверить с официальным документом.
              </small>
            </form>
          </section>

          <aside className="panel assistant-sources" aria-label="Источники ответа">
            <p className="eyebrow">Вахтенный журнал</p>
            <h2>Источники</h2>
            {latestSources.length ? (
              <ol>
                {latestSources.map((source) => (
                  <li key={source.id}>
                    <a href={source.url} rel="noreferrer" target="_blank">
                      [{source.id}] {source.title}
                    </a>
                    {source.factions.length ? <small>{source.factions.join(" · ")}</small> : null}
                    <p>{source.excerpt}</p>
                  </li>
                ))}
              </ol>
            ) : (
              <p>После ответа здесь появятся использованные выдержки из каталога.</p>
            )}
            <Link className="text-link" to="/reference">
              Открыть библиотеку правил →
            </Link>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
