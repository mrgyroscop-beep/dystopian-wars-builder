import { z } from "zod";

export const glossaryRuleSchema = z.object({
  id: z.string().regex(/^R\d+$/u),
  title: z.string().min(1),
  text: z.string().min(1),
  factions: z.array(z.string()),
  page: z.number().int().positive().nullable(),
});

export const glossaryResponseSchema = z.object({
  rules: z.array(glossaryRuleSchema),
});

export const ruleTranslationSchema = z.object({
  id: z.string().regex(/^R\d+$/u),
  language: z.literal("ru"),
  sourceTitle: z.string().min(1),
  title: z.string().min(1),
  text: z.string().min(1),
});

export type GlossaryRule = z.infer<typeof glossaryRuleSchema>;
export type RuleTranslation = z.infer<typeof ruleTranslationSchema>;

export interface GlossaryGateway {
  readonly contractVersion: 1;
  list(signal?: AbortSignal): Promise<readonly GlossaryRule[]>;
  translate(ruleId: string, signal?: AbortSignal): Promise<RuleTranslation>;
}
