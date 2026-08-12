import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import type { AuthGateway, AuthUser } from "../../application/auth/auth-contract";
import type { GlossaryGateway } from "../../application/glossary/glossary-contract";
import { GlossaryProvider, RuleLanguageToggle } from "../../ui/GlossaryContext";
import { AUTH_SESSION_CHANGED_EVENT } from "../authSessionEvents";
import { version as appVersion } from "../../../package.json";

const navigationItems = [
  { to: "/", label: "Флоты", end: true },
  { to: "/campaign", label: "Кампания", end: false },
  { to: "/battle", label: "Баталия", end: false },
  { to: "/reference", label: "Правила", end: false },
  { to: "/feedback", label: "Обратная связь", end: false },
  { to: "/settings", label: "Настройки", end: false },
] as const;

interface AppShellProps {
  authGateway: AuthGateway;
  glossaryGateway: GlossaryGateway;
}

export function AppShell({ authGateway, glossaryGateway }: AppShellProps) {
  return (
    <GlossaryProvider gateway={glossaryGateway}>
      <AppShellContent authGateway={authGateway} />
    </GlossaryProvider>
  );
}

function AppShellContent({ authGateway }: { readonly authGateway: AuthGateway }) {
  const location = useLocation();
  const feedbackSource = safeScreen(location.pathname);
  const isRosterWorkspace =
    location.pathname.startsWith("/rosters/") && location.pathname !== "/rosters/new";
  const [accountUser, setAccountUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let controller: AbortController | null = null;
    const refreshSession = () => {
      controller?.abort();
      const requestController = new AbortController();
      controller = requestController;
      authGateway.session(requestController.signal).then(
        (user) => setAccountUser(user),
        () => {
          if (!requestController.signal.aborted) setAccountUser(null);
        },
      );
    };

    refreshSession();
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, refreshSession);
    return () => {
      controller?.abort();
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, refreshSession);
    };
  }, [authGateway]);

  const accountLabel = accountUser?.displayName ?? "Войти";
  return (
    <div className={`app-shell${isRosterWorkspace ? " app-shell--workspace" : ""}`}>
      <a className="skip-link" href="#main-content">
        Перейти к содержимому
      </a>

      <header className="site-header">
        <div className="site-header__inner">
          <Link className="brand" to="/" aria-label="Dystopian Wars Builder — на главную">
            <span className="brand__mark" aria-hidden="true">
              <img
                alt=""
                decoding="async"
                height="256"
                src="/brand/fleet-builder-emblem.webp"
                width="256"
              />
            </span>
            <span className="brand__copy">
              <span className="brand__name">Fleet Builder</span>
              <span className="brand__edition">Dystopian Wars 4.0</span>
            </span>
          </Link>

          <nav className="primary-nav" aria-label="Основная навигация">
            {navigationItems.map((item) => (
              <NavLink
                className={({ isActive }) =>
                  isActive ? "primary-nav__link primary-nav__link--active" : "primary-nav__link"
                }
                end={item.end}
                key={item.to}
                state={item.to === "/feedback" ? { from: feedbackSource } : undefined}
                to={item.to}
              >
                {item.label}
              </NavLink>
            ))}
            <div className="site-header__language">
              <RuleLanguageToggle compact />
            </div>
            <Link
              aria-label={accountUser ? `Аккаунт: ${accountUser.displayName}` : "Войти в аккаунт"}
              className="primary-nav__account"
              title={accountUser ? `Аккаунт: ${accountUser.displayName}` : "Войти в аккаунт"}
              to="/settings#account-title"
            >
              {accountLabel}
            </Link>
          </nav>
        </div>
      </header>

      <main
        className={`main-content${isRosterWorkspace ? " main-content--workspace" : ""}`}
        id="main-content"
        tabIndex={-1}
      >
        <Outlet />
      </main>

      {isRosterWorkspace ? null : (
        <footer className="site-footer">
          <p>Dystopian Wars 4.0 · версия {appVersion} · локальные флоты доступны без регистрации</p>
        </footer>
      )}
    </div>
  );
}

function safeScreen(pathname: string): string {
  if (pathname === "/rosters/new") return "new-roster";
  if (pathname.startsWith("/rosters/")) return "roster-workspace";
  return pathname;
}
