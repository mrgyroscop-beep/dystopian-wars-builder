import { Hono } from "hono";
import { rulesCorpus } from "./rules-corpus.generated";

export const glossaryRoutes = new Hono<{ Bindings: Env }>();

glossaryRoutes.get("/", (context) => {
  context.header("Cache-Control", "public, max-age=3600");
  return context.json({ rules: rulesCorpus });
});
