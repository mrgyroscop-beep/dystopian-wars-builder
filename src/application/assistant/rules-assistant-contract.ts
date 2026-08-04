import { z } from "zod";

export const assistantMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2_000),
});

export const assistantRequestSchema = z
  .object({
    question: z.string().trim().min(3).max(800),
    history: z.array(assistantMessageSchema).max(6).default([]),
  })
  .strict();

export const assistantSourceSchema = z.object({
  id: z.string(),
  title: z.string(),
  excerpt: z.string(),
  factions: z.array(z.string()),
  url: z.string().url(),
});

export const assistantResponseSchema = z.object({
  answer: z.string().min(1),
  sources: z.array(assistantSourceSchema).max(6),
});

export type AssistantMessage = z.infer<typeof assistantMessageSchema>;
export type AssistantResponse = z.infer<typeof assistantResponseSchema>;

export interface RulesAssistantGateway {
  readonly contractVersion: 1;
  ask(question: string, history: readonly AssistantMessage[]): Promise<AssistantResponse>;
}
