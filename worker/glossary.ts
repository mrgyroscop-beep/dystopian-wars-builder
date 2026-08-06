import { Hono } from "hono";
import { z } from "zod";

import { ruleTranslationSchema } from "../src/application/glossary/glossary-contract";
import { HttpError, sha256 } from "./http";
import { rulesCorpus } from "./rules-corpus.generated";

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
  cacheUrl.searchParams.set("storage", "d1-v1");
  const cacheKey = new Request(cacheUrl, { method: "GET" });
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const translation = await context.env.DB.prepare(
    "SELECT source_title, title, text FROM rule_translations WHERE rule_id = ? AND language = ? AND source_hash = ?",
  )
    .bind(rule.id, "ru", sourceRevision)
    .first<{ source_title: string; title: string; text: string }>();
  if (!translation) {
    throw new HttpError(503, "translation_unavailable", "Перевод пока не опубликован.");
  }
  const payload = ruleTranslationSchema.parse({
    id: rule.id,
    language: "ru",
    sourceTitle: translation.source_title,
    title: translation.title,
    text: translation.text,
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
