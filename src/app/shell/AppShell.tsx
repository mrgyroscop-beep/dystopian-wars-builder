import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

const navigationItems = [
  { to: "/", label: "Флоты", end: true },
  { to: "/rosters/new", label: "Создать", end: false },
  { to: "/feedback", label: "Обратная связь", end: false },
  { to: "/settings", label: "Настройки", end: false },
] as const;

export function AppShell() {
  const location = useLocation();
  const feedbackSource = safeScreen(location.pathname);
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Перейти к содержимому
      </a>

      <header className="site-header">
        <div className="site-header__inner">
          <Link className="brand" to="/" aria-label="Dystopian Wars Builder — на главную">
            <span className="brand__mark" aria-hidden="true">
              DW
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
          </nav>
        </div>
      </header>

      <main className="main-content" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>

      <footer className="site-footer">
        <p>Технический каркас · игровые данные ещё не импортированы</p>
      </footer>
    </div>
  );
}

function safeScreen(pathname: string): string {
  if (pathname === "/rosters/new") return "new-roster";
  if (pathname.startsWith("/rosters/")) return "roster-workspace";
  return pathname;
}
