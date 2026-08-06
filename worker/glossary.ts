import { Hono, type Context } from "hono";
import { z } from "zod";

import { ruleTranslationSchema } from "../src/application/glossary/glossary-contract";
import { HttpError, sha256 } from "./http";
import { rulesCorpus } from "./rules-corpus.generated";

const translationModel = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const translationOutputSchema = z.object({
  title: z.string().trim().min(1),
  text: z.string().trim().min(1),
});
const ruleIdSchema = z.string().regex(/^R\d+$/u);

export const glossaryRoutes = new Hono<{ Bindings: Env }>();

glossaryRoutes.get("/", (context) => {
  context.header("Cache-Control", "public, max-age=3600");
  return context.json({ rules: rulesCorpus });
});

glossaryRoutes.get("/translations/:ruleId", async (context) => {
  const ruleId = ruleIdSchema.safeParse(context.req.param("ruleId"));
  if (!ruleId.success) throw new HttpError(404, "rule_not_found", "Термин не найден в глоссарии.");
  const rule = rulesCorpus.find((candidate) => candidate.id === ruleId.data);
  if (!rule) throw new HttpError(404, "rule_not_found", "Термин не найден в глоссарии.");

  const sourceRevision = await sha256(`${rule.title}\n${rule.text}`);
  const cacheUrl = new URL(context.req.url);
  cacheUrl.searchParams.set("source", sourceRevision);
  const cacheKey = new Request(cacheUrl, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  await enforceTranslationRateLimit(context);
  const result = await context.env.AI.run(translationModel, {
    messages: [
      {
        role: "system",
        content:
          "Ты редактор русского издания правил Dystopian Wars 4.0. Переводи точно и полностью, без сокращений, пояснений и добавления новых правил. Сохраняй числа, X, обозначения дистанций, структуру абзацев и названия игровых сущностей. Используй единообразную настольную терминологию: model — модель, unit — отряд, Action Roll — бросок действия, Resistance Roll — бросок сопротивления, Strike — успех, Disorder — беспорядок.",
      },
      {
        role: "user",
        content: `Переведи название и текст правила на русский.\n\nНазвание: ${rule.title}\n\nТекст:\n${rule.text}`,
      },
    ],
    max_tokens: 3_500,
    temperature: 0.1,
    response_format: {
      type: "json_schema",
      json_schema: {
        type: "object",
        properties: {
          title: { type: "string" },
          text: { type: "string" },
        },
        required: ["title", "text"],
        additionalProperties: false,
      },
    },
  });
  const generated = parseTranslation(
    typeof result === "string"
      ? result
      : typeof result === "object" &&
          result !== null &&
          "response" in result &&
          typeof result.response === "string"
        ? result.response
        : "",
  );
  const payload = ruleTranslationSchema.parse({
    id: rule.id,
    language: "ru",
    sourceTitle: rule.title,
    ...generated,
  });
  const response = Response.json(payload, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Language": "ru",
    },
  });
  await cache.put(cacheKey, response.clone());
  return response;
});

export function parseTranslation(value: string): z.infer<typeof translationOutputSchema> {
  try {
    return translationOutputSchema.parse(JSON.parse(value));
  } catch {
    throw new HttpError(503, "translation_unavailable", "Перевод сейчас недоступен.");
  }
}

async function enforceTranslationRateLimit(context: Context<{ Bindings: Env }>): Promise<void> {
  const client = context.req.header("cf-connecting-ip") ?? "local";
  const now = Math.floor(Date.now() / 1000);
  const bucket = `glossary-translation:${client}`;
  const row = await context.env.DB.prepare(
    "INSERT INTO rate_limits (bucket, window_started_at, request_count) VALUES (?, ?, 1) ON CONFLICT(bucket) DO UPDATE SET window_started_at = CASE WHEN window_started_at <= ? THEN excluded.window_started_at ELSE window_started_at END, request_count = CASE WHEN window_started_at <= ? THEN 1 ELSE request_count + 1 END RETURNING request_count",
  )
    .bind(bucket, now, now - 60, now - 60)
    .first<{ request_count: number }>();
  if (!row || row.request_count > 10)
    throw new HttpError(
      429,
      "rate_limited",
      "Лимит переводов — 10 терминов в минуту. Попробуйте позже.",
    );
}
