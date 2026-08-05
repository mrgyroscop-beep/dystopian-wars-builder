import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import type { AuthGateway } from "../application/auth/auth-contract";
import type { RulesAssistantGateway } from "../application/assistant/rules-assistant-contract";
import { useDocumentTitle } from "../app/useDocumentTitle";
import { PdfDocumentViewer } from "../ui/PdfDocumentViewer";
import { RulesAssistantPanel } from "./RulesAssistantRoute";

type ReferenceKind = "rules" | "orbat";
type ReferenceFilter = "all" | ReferenceKind;

interface ReferenceEntry {
  readonly id: string;
  readonly kind: ReferenceKind;
  readonly eyebrow: string;
  readonly title: string;
  readonly summary: string;
  readonly meta: string;
  readonly href: string;
  readonly sectionHref?: string;
  readonly action: string;
}

const rules: readonly ReferenceEntry[] = [
  {
    id: "rules-4-00",
    kind: "rules",
    eyebrow: "Основной документ",
    title: "Правила 4.00",
    summary: "Полные правила движения, действий, стрельбы, повреждений и сценариев.",
    meta: "PDF · English · Warcradle",
    href: "/reference-pdf/rules-4-00",
    action: "Читать внутри",
  },
  {
    id: "glossary-4-03a",
    kind: "rules",
    eyebrow: "Живой справочник",
    title: "Rules Glossary 4.03a",
    summary: "Актуальные свойства, системы и качества из профилей кораблей.",
    meta: "PDF · English · обновлено 22.07.2026",
    href: "/reference-pdf/glossary-4-03a",
    action: "Читать внутри",
  },
  {
    id: "quick-reference",
    kind: "rules",
    eyebrow: "За игровым столом",
    title: "Quick Reference",
    summary: "Краткие таблицы раунда, атак, повреждений, дистанций и состояний.",
    meta: "PDF · 12 страниц · English",
    href: "/reference-pdf/quick-reference",
    action: "Читать внутри",
  },
];

const factions = [
  ["alliance", "Alliance", "Латинский союз и его союзники"],
  ["commonwealth", "Commonwealth", "Флоты Содружества"],
  ["crown", "Crown", "Королевские доминионы"],
  ["empire", "Empire", "Небесная империя"],
  ["enlightened", "Enlightened", "Конвент Просвещённых"],
  ["imperium", "Imperium", "Имперские государства Европы"],
  ["sultanate", "Sultanate", "Османский султанат"],
  ["union", "Union", "Союз американских штатов"],
] as const;

const orbats: readonly ReferenceEntry[] = factions.map(([slug, title, summary]) => ({
  id: `orbat-${slug}`,
  kind: "orbat",
  eyebrow: "Order of Battle",
  title,
  summary: `${summary}. Актуальный ORBAT, профили и материалы фракции.`,
  meta: "PDF · English · Warcradle",
  href: `/reference-pdf/orbat-${slug}`,
  sectionHref: `https://www.dystopianwars.com/factions/${slug}`,
  action: "Открыть ORBAT",
}));

const entries = [...rules, ...orbats];
const filters: readonly [ReferenceFilter, string][] = [
  ["all", "Все материалы"],
  ["rules", "Правила"],
  ["orbat", "ORBATS"],
];

export function ReferenceLibraryRoute({
  authGateway,
  assistantGateway,
}: {
  authGateway: AuthGateway;
  assistantGateway: RulesAssistantGateway;
}) {
  useDocumentTitle("Правила и ORBATs");
  const [searchParams, setSearchParams] = useSearchParams();
  const assistantOpen = searchParams.get("view") === "assistant";
  const [filter, setFilter] = useState<ReferenceFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedDocument, setSelectedDocument] = useState<ReferenceEntry | null>(null);
  const viewerRef = useRef<HTMLElement>(null);
  const normalizedSearch = search.trim().toLocaleLowerCase("ru");
  const visibleEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (filter === "all" || entry.kind === filter) &&
          (!normalizedSearch ||
            [entry.title, entry.summary, entry.eyebrow, entry.meta]
              .join(" ")
              .toLocaleLowerCase("ru")
              .includes(normalizedSearch)),
      ),
    [filter, normalizedSearch],
  );

  useEffect(() => {
    if (selectedDocument)
      viewerRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [selectedDocument]);

  function showLibrary() {
    setSearchParams({}, { replace: true });
  }

  function showAssistant() {
    setSelectedDocument(null);
    setSearchParams({ view: "assistant" }, { replace: true });
  }

  return (
    <div className="reference-library section-stack">
      <header className="reference-library__hero">
        <div>
          <p className="eyebrow">Адмиралтейская библиотека</p>
          <h1>Правила и ORBATs</h1>
          <p className="page-lead">
            Официальные документы Dystopian Wars 4.0 и Старпом, который поможет найти нужное
            правило.
          </p>
        </div>
        <div className="reference-library__index" aria-label="Состав библиотеки">
          <span>
            <b>{rules.length}</b> справочника
          </span>
          <span>
            <b>{orbats.length}</b> фракций
          </span>
        </div>
      </header>

      <nav className="reference-sections" aria-label="Раздел правил">
        <button
          aria-current={!assistantOpen ? "page" : undefined}
          onClick={showLibrary}
          type="button"
        >
          Документы
        </button>
        <button
          aria-current={assistantOpen ? "page" : undefined}
          onClick={showAssistant}
          type="button"
        >
          Спросить Старпома
        </button>
      </nav>

      {assistantOpen ? (
        <RulesAssistantPanel authGateway={authGateway} assistantGateway={assistantGateway} />
      ) : (
        <>
          <section className="reference-library__controls" aria-label="Поиск и фильтры">
            <div className="reference-library__filters" role="group" aria-label="Тип материала">
              {filters.map(([value, label]) => (
                <button
                  aria-pressed={filter === value}
                  key={value}
                  onClick={() => setFilter(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="reference-library__search">
              <span>Поиск по библиотеке</span>
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Например, Empire или Glossary"
                type="search"
                value={search}
              />
            </label>
          </section>

          <p aria-live="polite" className="reference-library__result">
            Найдено материалов: {visibleEntries.length}
          </p>

          {visibleEntries.length ? (
            <section className="reference-library__grid" aria-label="Материалы">
              {visibleEntries.map((entry, index) => (
                <article className="reference-card" data-kind={entry.kind} key={entry.id}>
                  <header>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <p>{entry.eyebrow}</p>
                  </header>
                  <div>
                    <h2>{entry.title}</h2>
                    <p>{entry.summary}</p>
                  </div>
                  <footer>
                    <small>{entry.meta}</small>
                    {entry.kind === "rules" ? (
                      <button onClick={() => setSelectedDocument(entry)} type="button">
                        {entry.action} <span aria-hidden="true">↓</span>
                      </button>
                    ) : (
                      <div className="reference-card__actions">
                        <a
                          className="reference-card__section-link"
                          href={entry.sectionHref}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Открыть раздел <span aria-hidden="true">↗</span>
                        </a>
                        <button onClick={() => setSelectedDocument(entry)} type="button">
                          {entry.action} <span aria-hidden="true">↓</span>
                        </button>
                      </div>
                    )}
                  </footer>
                </article>
              ))}
            </section>
          ) : (
            <section className="reference-library__empty">
              <p className="eyebrow">Сигнал не найден</p>
              <h2>Нет подходящих материалов</h2>
              <p>Измените запрос или выберите другой раздел библиотеки.</p>
              <button
                className="button button--secondary"
                onClick={() => {
                  setFilter("all");
                  setSearch("");
                }}
                type="button"
              >
                Сбросить фильтры
              </button>
            </section>
          )}

          {selectedDocument ? (
            <section className="reference-viewer" ref={viewerRef}>
              <header>
                <div>
                  <p className="eyebrow">Встроенный просмотр</p>
                  <h2>{selectedDocument.title}</h2>
                </div>
                <button onClick={() => setSelectedDocument(null)} type="button">
                  Закрыть
                </button>
              </header>
              <PdfDocumentViewer
                key={selectedDocument.id}
                source={selectedDocument.href}
                title={selectedDocument.title}
              />
            </section>
          ) : null}

          <p className="reference-library__source">
            PDF открываются внутри билдера; документы загружаются с официального сайта Warcradle.
          </p>
        </>
      )}
    </div>
  );
}
