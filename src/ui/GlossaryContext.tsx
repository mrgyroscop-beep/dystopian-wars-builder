import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type {
  GlossaryGateway,
  GlossaryRule,
  RuleTranslation,
} from "../application/glossary/glossary-contract";

export type RuleLanguage = "ru" | "en";

interface GlossaryContextValue {
  readonly gateway: GlossaryGateway | null;
  readonly language: RuleLanguage;
  readonly setLanguage: (language: RuleLanguage) => void;
}

const storageKey = "dwb-rule-language";
const fallbackContext: GlossaryContextValue = {
  gateway: null,
  language: "en",
  setLanguage: () => undefined,
};
const GlossaryContext = createContext<GlossaryContextValue>(fallbackContext);

export function GlossaryProvider({
  children,
  gateway,
}: {
  readonly children: ReactNode;
  readonly gateway: GlossaryGateway;
}) {
  const [language, setLanguageState] = useState<RuleLanguage>(readLanguage);
  const value = useMemo<GlossaryContextValue>(
    () => ({
      gateway,
      language,
      setLanguage(next) {
        setLanguageState(next);
        try {
          window.localStorage.setItem(storageKey, next);
        } catch {
          // The preference remains active for this session when storage is unavailable.
        }
      },
    }),
    [gateway, language],
  );
  return <GlossaryContext.Provider value={value}>{children}</GlossaryContext.Provider>;
}

export function useGlossary() {
  return useContext(GlossaryContext);
}

export function RuleLanguageToggle({ compact = false }: { readonly compact?: boolean }) {
  const { language, setLanguage } = useGlossary();
  return (
    <div
      aria-label="Язык правил"
      className="rule-language-toggle"
      data-compact={compact ? "true" : undefined}
      role="group"
    >
      {(["ru", "en"] as const).map((value) => (
        <button
          aria-pressed={language === value}
          key={value}
          onClick={() => setLanguage(value)}
          type="button"
        >
          {value.toLocaleUpperCase("en")}
        </button>
      ))}
    </div>
  );
}

export function useRuleTranslation(
  title: string,
  embedded?: RuleTranslation,
): {
  readonly language: RuleLanguage;
  readonly translation: RuleTranslation | null;
  readonly loading: boolean;
  readonly error: string | null;
} {
  const { gateway, language } = useGlossary();
  const [state, setState] = useState<{
    readonly key: string;
    readonly translation: RuleTranslation | null;
    readonly loading: boolean;
    readonly error: string | null;
  }>({ key: "", translation: null, loading: false, error: null });
  const key = `${language}:${title}`;

  useEffect(() => {
    if (language !== "ru" || !gateway || embedded) return;
    const controller = new AbortController();
    void gateway
      .list(controller.signal)
      .then((rules) => findRule(rules, title))
      .then((rule) => {
        if (!rule) throw new Error("Термин не найден в текстовом глоссарии.");
        return gateway.translate(rule.id, controller.signal);
      })
      .then(
        (translation) => {
          if (!controller.signal.aborted)
            setState({ key, translation, loading: false, error: null });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setState({
              key,
              translation: null,
              loading: false,
              error: error instanceof Error ? error.message : "Перевод сейчас недоступен.",
            });
        },
      );
    return () => controller.abort();
  }, [embedded, gateway, key, language, title]);

  if (language === "ru" && embedded)
    return { language, translation: embedded, loading: false, error: null };

  if (state.key !== key)
    return {
      language,
      translation: null,
      loading: language === "ru" && Boolean(gateway),
      error: null,
    };
  return { language, ...state };
}

function readLanguage(): RuleLanguage {
  try {
    return window.localStorage.getItem(storageKey) === "en" ? "en" : "ru";
  } catch {
    return "ru";
  }
}

function findRule(rules: readonly GlossaryRule[], title: string): GlossaryRule | null {
  const normalized = normalizeTitle(title);
  return rules.find((rule) => normalizeTitle(rule.title) === normalized) ?? null;
}

function normalizeTitle(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}
