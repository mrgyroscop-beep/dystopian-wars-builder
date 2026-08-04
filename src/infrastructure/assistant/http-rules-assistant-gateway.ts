import { z } from "zod";

import {
  assistantResponseSchema,
  type AssistantMessage,
  type RulesAssistantGateway,
} from "../../application/assistant/rules-assistant-contract";

export function createHttpRulesAssistantGateway(
  fetcher: typeof fetch = fetch,
): RulesAssistantGateway {
  return {
    contractVersion: 1,
    async ask(question: string, history: readonly AssistantMessage[]) {
      const response = await fetcher("/api/assistant/ask", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history: history.slice(-6) }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const error = z.object({ error: z.object({ message: z.string() }) }).safeParse(payload);
        throw new Error(error.success ? error.data.error.message : "Старпом сейчас не отвечает.");
      }
      return assistantResponseSchema.parse(payload);
    },
  };
}
