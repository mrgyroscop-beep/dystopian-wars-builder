import {
  glossaryResponseSchema,
  ruleTranslationSchema,
  type GlossaryGateway,
} from "../../application/glossary/glossary-contract";

export function createHttpGlossaryGateway(fetcher: typeof fetch = fetch): GlossaryGateway {
  let glossaryPromise: ReturnType<GlossaryGateway["list"]> | null = null;
  const translations = new Map<string, ReturnType<GlossaryGateway["translate"]>>();

  return {
    contractVersion: 1,
    list() {
      glossaryPromise ??= fetcher("/api/glossary", {
        headers: { Accept: "application/json" },
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Глоссарий сейчас недоступен.");
          return glossaryResponseSchema.parse(await response.json()).rules;
        })
        .catch((error: unknown) => {
          glossaryPromise = null;
          throw error;
        });
      return glossaryPromise;
    },
    translate(ruleId) {
      let request = translations.get(ruleId);
      if (!request) {
        request = fetcher(`/api/glossary/translations/${encodeURIComponent(ruleId)}`, {
          headers: { Accept: "application/json" },
        })
          .then(async (response) => {
            if (!response.ok) {
              const payload: unknown = await response.json().catch(() => null);
              const message =
                typeof payload === "object" &&
                payload !== null &&
                "error" in payload &&
                typeof payload.error === "object" &&
                payload.error !== null &&
                "message" in payload.error &&
                typeof payload.error.message === "string"
                  ? payload.error.message
                  : "Перевод сейчас недоступен.";
              throw new Error(message);
            }
            return ruleTranslationSchema.parse(await response.json());
          })
          .catch((error: unknown) => {
            translations.delete(ruleId);
            throw error;
          });
        translations.set(ruleId, request);
      }
      return request;
    },
  };
}
