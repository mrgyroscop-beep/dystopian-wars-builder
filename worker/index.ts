import { Hono } from "hono";

import { healthResponseSchema } from "../src/application/health/health-contract";
import { applyApiSecurityHeaders, createSafeRequestId, writeSafeErrorLog } from "./security";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (context, next) => {
  await next();
  applyApiSecurityHeaders(context.res.headers);
});

app.get("/api/health", (context) => {
  const payload = healthResponseSchema.parse({
    status: "ok",
    environment: context.env.DEPLOYMENT_ENV,
    appVersion: context.env.APP_VERSION,
    catalogVersion: context.env.CATALOG_VERSION,
    commitSha: context.env.COMMIT_SHA,
  });

  context.header("Cache-Control", "no-store");
  return context.json(payload, 200);
});

app.notFound((context) =>
  context.json(
    {
      error: {
        code: "not_found",
        message: "API route not found.",
      },
    },
    404,
  ),
);

app.onError((_error, context) => {
  const requestId = createSafeRequestId(context.req.header("cf-ray"));
  writeSafeErrorLog(console, {
    requestId,
    method: context.req.method,
    route: context.req.path.startsWith("/api/") ? "api" : "other",
  });

  return context.json(
    {
      error: {
        code: "internal_error",
        message: "Unexpected Worker error.",
        requestId,
      },
    },
    500,
  );
});

export default app;
