import { useEffect, useState } from "react";

import type { AuthGateway, AuthUser } from "../application/auth/auth-contract";
import {
  getHealth,
  type HealthGateway,
  type HealthResponse,
} from "../application/health/health-contract";
import { useDocumentTitle } from "../app/useDocumentTitle";
import type { RosterSyncGateway, RosterSyncResult } from "../application/rosters/roster-sync";

type HealthState =
  | { kind: "loading" }
  | { kind: "success"; data: HealthResponse }
  | { kind: "error"; message: string };
type AccountState =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "authenticated"; user: AuthUser }
  | { kind: "error"; message: string };

interface SettingsRouteProps {
  authGateway: AuthGateway;
  healthGateway: HealthGateway;
  rosterSync: RosterSyncGateway;
}

export function SettingsRoute({ authGateway, healthGateway, rosterSync }: SettingsRouteProps) {
  useDocumentTitle("Настройки");
  const [health, setHealth] = useState<HealthState>({ kind: "loading" });
  const [account, setAccount] = useState<AccountState>({ kind: "loading" });
  const [displayName, setDisplayName] = useState("");
  const [accountMessage, setAccountMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    getHealth(healthGateway, controller.signal).then(
      (data) => setHealth({ kind: "success", data }),
      (error: unknown) => {
        if (!controller.signal.aborted)
          setHealth({
            kind: "error",
            message: error instanceof Error ? error.message : "Неизвестная ошибка API.",
          });
      },
    );
    authGateway.session(controller.signal).then(
      (user) => setAccount(user ? { kind: "authenticated", user } : { kind: "anonymous" }),
      (error: unknown) => {
        if (!controller.signal.aborted)
          setAccount({
            kind: "error",
            message: error instanceof Error ? error.message : "Не удалось проверить сессию.",
          });
      },
    );
    return () => controller.abort();
  }, [authGateway, healthGateway]);

  async function finishAuthentication(action: () => Promise<AuthUser>) {
    setBusy(true);
    setAccountMessage("");
    try {
      const user = await action();
      setAccount({ kind: "authenticated", user });
      setAccountMessage(syncMessage(await rosterSync.syncNow()));
    } catch (error) {
      setAccountMessage(error instanceof Error ? error.message : "Не удалось выполнить вход.");
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    try {
      setAccountMessage(syncMessage(await rosterSync.syncNow()));
    } catch (error) {
      setAccountMessage(
        error instanceof Error ? error.message : "Не удалось синхронизировать флоты.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await authGateway.logout();
      setAccount({ kind: "anonymous" });
      setAccountMessage("Вы вышли. Локальные флоты остались на устройстве.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteAccount() {
    if (
      !window.confirm(
        "Удалить аккаунт и все серверные копии флотов? Локальные копии останутся на этом устройстве.",
      )
    )
      return;
    setBusy(true);
    try {
      await authGateway.deleteAccount();
      setAccount({ kind: "anonymous" });
      setAccountMessage("Аккаунт и серверные данные удалены. Локальные флоты сохранены.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="section-stack">
      <div className="page-header">
        <p className="eyebrow">Системная информация</p>
        <h1>Настройки</h1>
        <p className="page-lead">
          Локальная работа доступна всегда. Аккаунт добавляет защищённую копию флотов для других
          устройств.
        </p>
      </div>

      <section className="panel" aria-labelledby="account-title">
        <div className="panel__header">
          <div>
            <h2 id="account-title">Аккаунт и синхронизация</h2>
            <p className="panel__copy">
              Passkey хранится в защищённом хранилище устройства. Сервер получает только публичный
              ключ и имя.
            </p>
          </div>
          <span className="badge">WebAuthn · D1</span>
        </div>

        {account.kind === "loading" ? (
          <p className="status-line" role="status">
            Проверяем сессию…
          </p>
        ) : account.kind === "authenticated" ? (
          <div className="section-stack section-stack--compact">
            <p className="status-line">
              Выполнен вход: <strong>{account.user.displayName}</strong>
            </p>
            <div className="roster-library__primary-actions">
              <button
                className="button"
                disabled={busy}
                onClick={() => void syncNow()}
                type="button"
              >
                Синхронизировать сейчас
              </button>
              <button
                className="button button--secondary"
                disabled={busy}
                onClick={() => void logout()}
                type="button"
              >
                Выйти
              </button>
              <button
                className="button button--danger"
                disabled={busy}
                onClick={() => void deleteAccount()}
                type="button"
              >
                Удалить аккаунт
              </button>
            </div>
          </div>
        ) : (
          <div className="section-stack section-stack--compact">
            {account.kind === "error" ? (
              <p className="status-line status-line--error" role="alert">
                {account.message}
              </p>
            ) : null}
            <label>
              <span>Имя в приложении</span>
              <input
                autoComplete="nickname"
                maxLength={80}
                onChange={(event) => setDisplayName(event.target.value)}
                value={displayName}
              />
            </label>
            <div className="roster-library__primary-actions">
              <button
                className="button"
                disabled={busy || !displayName.trim()}
                onClick={() =>
                  void finishAuthentication(() => authGateway.register(displayName.trim()))
                }
                type="button"
              >
                Создать аккаунт с passkey
              </button>
              <button
                className="button button--secondary"
                disabled={busy}
                onClick={() => void finishAuthentication(() => authGateway.login())}
                type="button"
              >
                Войти с passkey
              </button>
            </div>
            <p className="panel__copy">
              До входа приложение продолжает работать локально и без сети.
            </p>
          </div>
        )}
        <p aria-live="polite" className={accountMessage ? "system-message" : "sr-only"}>
          {accountMessage}
        </p>
      </section>

      <section className="panel" aria-labelledby="health-title">
        <div className="panel__header">
          <div>
            <h2 id="health-title">Состояние приложения</h2>
            <p className="panel__copy">Worker API и версия текущего выпуска.</p>
          </div>
          <span className="badge">GET /api/health</span>
        </div>
        {health.kind === "loading" ? (
          <p className="status-line" role="status" aria-busy="true">
            Проверяем Worker API…
          </p>
        ) : health.kind === "error" ? (
          <div className="status-line status-line--error" role="alert">
            API недоступен. <small>{health.message}</small>
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
        <h2 id="boundaries-title">Границы данных</h2>
        <p className="panel__copy">
          Игровой каталог пока демонстрационный. Локальные флоты доступны без аккаунта; аккаунт
          добавляет только защищённую серверную копию.
        </p>
      </section>
    </div>
  );
}

function syncMessage(result: RosterSyncResult): string {
  if (!result.authenticated) return "Сессия истекла. Локальные флоты не изменены.";
  if (result.conflicts)
    return `Синхронизация завершена. Конфликтов: ${result.conflicts}; для каждого сохранена отдельная локальная копия.`;
  return `Синхронизация завершена: отправлено ${result.uploaded}, загружено ${result.downloaded}.`;
}
