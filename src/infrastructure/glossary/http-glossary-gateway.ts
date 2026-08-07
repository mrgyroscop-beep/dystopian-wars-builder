import {
  glossaryResponseSchema,
  type GlossaryGateway,
} from "../../application/glossary/glossary-contract";

export function createHttpGlossaryGateway(fetcher: typeof fetch = fetch): GlossaryGateway {
  let glossaryPromise: ReturnType<GlossaryGateway["list"]> | null = null;

  return {
    contractVersion: 1,
    list() {
      glossaryPromise ??= fetcher("/api/glossary?translations=ru-v1", {
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
  };
}
