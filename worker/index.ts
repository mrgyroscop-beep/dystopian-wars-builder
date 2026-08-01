import { Hono } from "hono";

import {
  APP_VERSION,
  CATALOG_VERSION,
  healthResponseSchema,
} from "../src/application/health/health-contract";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (context) => {
  const payload = healthResponseSchema.parse({
    status: "ok",
    appVersion: APP_VERSION,
    catalogVersion: CATALOG_VERSION,
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

app.onError((error, context) => {
  const requestId = context.req.header("cf-ray") ?? crypto.randomUUID();

  console.error(
    JSON.stringify({
      event: "worker_error",
      requestId,
      method: context.req.method,
      path: context.req.path,
      message: error.message,
    }),
  );

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
