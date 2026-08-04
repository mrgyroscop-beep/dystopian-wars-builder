import { useMemo, useState } from "react";

import { useDocumentTitle } from "../app/useDocumentTitle";

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
    href: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/pdfs/essentials/DW-Rule-Book-4.00_Full_W.pdf",
    action: "Открыть правила",
  },
  {
    id: "glossary-4-03a",
    kind: "rules",
    eyebrow: "Живой справочник",
    title: "Rules Glossary 4.03a",
    summary: "Актуальные свойства, системы и качества из профилей кораблей.",
    meta: "PDF · English · обновлено 22.07.2026",
    href: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/pdfs/essentials/DW4-Rules-Glossary-v4.03a_W.pdf",
    action: "Открыть глоссарий",
  },
  {
    id: "quick-reference",
    kind: "rules",
    eyebrow: "За игровым столом",
    title: "Quick Reference",
    summary: "Краткие таблицы раунда, атак, повреждений, дистанций и состояний.",
    meta: "PDF · 12 страниц · English",
    href: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/pdfs/essentials/Quick-Reference-Guide_W.pdf",
    action: "Открыть памятку",
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
  meta: "Официальная страница фракции",
  href: `https://www.dystopianwars.com/factions/${slug}`,
  action: "Открыть ORBAT",
}));

const entries = [...rules, ...orbats];
const filters: readonly [ReferenceFilter, string][] = [
  ["all", "Все материалы"],
  ["rules", "Правила"],
  ["orbat", "ORBATS"],
];

export function ReferenceLibraryRoute() {
  useDocumentTitle("Правила и ORBATs");
  const [filter, setFilter] = useState<ReferenceFilter>("all");
  const [search, setSearch] = useState("");
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

  return (
    <div className="reference-library section-stack">
      <header className="reference-library__hero">
        <div>
          <p className="eyebrow">Адмиралтейская библиотека</p>
          <h1>Правила и ORBATs</h1>
          <p className="page-lead">
            Официальные документы Dystopian Wars 4.0 — от базовых правил до актуального состава
            каждой фракции.
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
                <a href={entry.href} rel="noreferrer" target="_blank">
                  {entry.action} <span aria-hidden="true">↗</span>
                </a>
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

      <p className="reference-library__source">
        Ссылки ведут на официальный сайт Dystopian Wars, поэтому всегда открывают опубликованную
        Warcradle версию документа.
      </p>
    </div>
  );
}
