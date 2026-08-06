import { useEffect, useMemo, useState } from "react";

import type { GlossaryRule, RuleTranslation } from "../application/glossary/glossary-contract";
import { translatedRuleTitle } from "../application/glossary/rule-title-translations";
import { RuleLanguageToggle, useGlossary } from "../ui/GlossaryContext";

export function GlossaryPanel() {
  const { gateway, language } = useGlossary();
  const [rules, setRules] = useState<readonly GlossaryRule[]>([]);
  const [translations, setTranslations] = useState<ReadonlyMap<string, RuleTranslation>>(
    () => new Map(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [translationError, setTranslationError] = useState<{
    readonly id: string;
    readonly message: string;
  } | null>(null);
  const normalizedSearch = normalize(search);
  const visibleRules = useMemo(
    () =>
      rules.filter((rule) => {
        if (!normalizedSearch) return true;
        const translated = translations.get(rule.id);
        return normalize(
          `${rule.title} ${translated?.title ?? ""} ${translatedRuleTitle(rule.title) ?? ""}`,
        ).includes(normalizedSearch);
      }),
    [normalizedSearch, rules, translations],
  );
  const selected =
    rules.find((rule) => rule.id === selectedId) ?? visibleRules[0] ?? rules[0] ?? null;
  const translated = selected ? (translations.get(selected.id) ?? null) : null;
  const translationLoading = Boolean(
    language === "ru" && selected && !translated && translationError?.id !== selected.id,
  );

  useEffect(() => {
    if (!gateway) {
      return;
    }
    const controller = new AbortController();
    void gateway.list(controller.signal).then(
      (nextRules) => {
        if (controller.signal.aborted) return;
        setRules(nextRules);
        setSelectedId((current) => current ?? nextRules[0]?.id ?? null);
        setLoading(false);
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : "Глоссарий сейчас недоступен.");
          setLoading(false);
        }
      },
    );
    return () => controller.abort();
  }, [gateway]);

  useEffect(() => {
    if (!gateway || language !== "ru" || !selected || translated) return;
    const controller = new AbortController();
    void Promise.resolve().then(() => setTranslationError(null));
    void gateway.translate(selected.id, controller.signal).then(
      (translation) => {
        if (controller.signal.aborted) return;
        setTranslations((current) => new Map(current).set(selected.id, translation));
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) {
          setTranslationError({
            id: selected.id,
            message: reason instanceof Error ? reason.message : "Перевод сейчас недоступен.",
          });
        }
      },
    );
    return () => controller.abort();
  }, [gateway, language, selected, translated]);

  if (loading)
    return (
      <section className="text-glossary text-glossary--loading" aria-busy="true">
        <p className="eyebrow">Текстовый справочник</p>
        <h2>Поднимаем сигнальные флаги…</h2>
        <p>Загружаем свойства, системы и качества оружия.</p>
      </section>
    );

  if (error || !gateway)
    return (
      <section className="text-glossary text-glossary--error" role="alert">
        <p className="eyebrow">Связь потеряна</p>
        <h2>Глоссарий не загрузился</h2>
        <p>{error ?? "Глоссарий сейчас недоступен."}</p>
      </section>
    );

  return (
    <section className="text-glossary" aria-labelledby="text-glossary-title">
      <header className="text-glossary__heading">
        <div>
          <p className="eyebrow">Текстовый справочник · {rules.length} терминов</p>
          <h2 id="text-glossary-title">Глоссарий правил</h2>
          <p>
            Быстрый поиск без PDF. Русский перевод создаётся для выбранного термина и сохраняется
            для следующих открытий.
          </p>
        </div>
        <RuleLanguageToggle />
      </header>

      <label className="text-glossary__search">
        <span>Найти свойство, систему или качество</span>
        <input
          autoComplete="off"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Например, Torpedo или Торпеда"
          type="search"
          value={search}
        />
        <small aria-live="polite">Найдено: {visibleRules.length}</small>
      </label>

      <div className="text-glossary__layout">
        <nav aria-label="Термины глоссария" className="text-glossary__index">
          {visibleRules.length ? (
            <ol>
              {visibleRules.map((rule, index) => {
                const translation = translations.get(rule.id);
                return (
                  <li key={rule.id}>
                    <button
                      aria-current={selected?.id === rule.id ? "true" : undefined}
                      onClick={() => setSelectedId(rule.id)}
                      type="button"
                    >
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <strong>
                        {language === "ru"
                          ? (translation?.title ?? translatedRuleTitle(rule.title) ?? rule.title)
                          : rule.title}
                      </strong>
                      {language === "ru" && (translation || translatedRuleTitle(rule.title)) ? (
                        <small>{rule.title}</small>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="text-glossary__empty">
              <strong>Термин не найден</strong>
              <p>Попробуйте английское название или более короткий запрос.</p>
              <button onClick={() => setSearch("")} type="button">
                Очистить поиск
              </button>
            </div>
          )}
        </nav>

        {selected ? (
          <article className="text-glossary__entry" key={selected.id}>
            <header>
              <p>
                {language === "ru" && translationError?.id !== selected.id
                  ? "Русский перевод"
                  : "English original"}
              </p>
              <h3>
                {language === "ru"
                  ? (translated?.title ?? translatedRuleTitle(selected.title) ?? selected.title)
                  : selected.title}
              </h3>
              {language === "ru" && (translated || translatedRuleTitle(selected.title)) ? (
                <small>{selected.title}</small>
              ) : null}
            </header>

            {language === "ru" && translationLoading ? (
              <div aria-live="polite" className="text-glossary__translation-state">
                <span aria-hidden="true">↻</span>
                <p>
                  <strong>Переводим термин</strong>
                  Точная формулировка появится здесь через несколько секунд.
                </p>
              </div>
            ) : (
              <div className="text-glossary__copy">
                {(language === "ru" && translated ? translated.text : selected.text)
                  .split(/\n{2,}/u)
                  .map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
              </div>
            )}

            {language === "ru" && translationError?.id === selected.id ? (
              <div className="text-glossary__translation-error" role="note">
                <strong>Показываем оригинал</strong>
                <p>{translationError.message}</p>
              </div>
            ) : null}

            <footer>
              <span>{selected.factions.join(" · ") || "Все фракции"}</span>
              {selected.page ? <span>Glossary · стр. {selected.page}</span> : null}
            </footer>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
