import { z } from "zod";

import type {
  FeedbackGateway,
  FeedbackSubmission,
} from "../../application/feedback/feedback-contract";

const receiptSchema = z.object({
  id: z.string().regex(/^fb_[0-9a-f-]{36}$/u),
  duplicate: z.boolean(),
});

export function createHttpFeedbackGateway(fetcher: typeof fetch = fetch): FeedbackGateway {
  return {
    contractVersion: 1,
    async submit(submission: FeedbackSubmission) {
      const response = await fetcher("/api/feedback", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const error = z.object({ error: z.object({ message: z.string() }) }).safeParse(payload);
        throw new Error(
          error.success ? error.data.error.message : "Не удалось отправить обращение.",
        );
      }
      return receiptSchema.parse(payload);
    },
  };
}
