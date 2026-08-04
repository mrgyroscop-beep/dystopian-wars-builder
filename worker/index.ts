import { Hono } from "hono";
import { z } from "zod";

import { healthResponseSchema } from "../src/application/health/health-contract";
import { authRoutes } from "./auth";
import { assistantRoutes } from "./assistant";
import { feedbackRoutes, isFeedbackAutomationPath } from "./feedback";
import { assertSameOrigin, HttpError } from "./http";
import { rosterRoutes } from "./rosters";
import { referencePdfRoutes } from "./reference-pdf";
import {
  applyApiSecurityHeaders,
  createSafeErrorName,
  createSafeRequestId,
  writeSafeErrorLog,
} from "./security";

const app = new Hono<{ Bindings: Env }>();

app.use("/api/*", async (context, next) => {
  if (!isFeedbackAutomationPath(context.req.path)) assertSameOrigin(context);
  await next();
  applyApiSecurityHeaders(context.res.headers);
});

app.route("/api/auth", authRoutes);
app.route("/api/assistant", assistantRoutes);
app.route("/api/feedback", feedbackRoutes);
app.route("/api/rosters", rosterRoutes);
app.route("/reference-pdf", referencePdfRoutes);

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

app.onError((error, context) => {
  if (error instanceof HttpError)
    return context.json({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof z.ZodError)
    return context.json(
      { error: { code: "invalid_request", message: "Request data is invalid." } },
      400,
    );
  const requestId = createSafeRequestId(context.req.header("cf-ray"));
  writeSafeErrorLog(console, {
    requestId,
    method: context.req.method,
    route: context.req.path.startsWith("/api/") ? "api" : "other",
    errorName: createSafeErrorName(error),
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
