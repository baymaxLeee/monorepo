import { Hono } from "hono";

import { requestLogger, traceMiddleware } from "@backend/kernel-ts";

import { problemJson } from "../api/http/problem.js";
import { logger } from "../infrastructure/observability/logger.js";
import { checkReadiness, currentBootState, isBootReady } from "../infrastructure/health/readiness.js";
import { internalAuthMiddleware } from "../api/http/middleware/auth.js";
import { tasksRoutes } from "../api/http/routes/tasks.js";
import { videoProductionRoutes } from "../api/http/routes/video-productions.js";

export function createApp() {
  const app = new Hono();

  app.use("*", traceMiddleware());
  app.use("*", requestLogger(logger));

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/livez", (c) =>
    c.json(
      { status: currentBootState() === "failed" ? "failed" : "ok" },
      currentBootState() === "failed" ? 503 : 200,
    ));
  app.get("/readyz", async (c) => {
    const report = await checkReadiness();
    return c.json(
      {
        status: report.ok ? "ok" : "degraded",
        boot: report.boot,
        postgres: report.postgres,
        workflow_world: report.workflowWorld,
        ...(report.error ? { error: report.error } : {}),
      },
      report.ok ? 200 : 503,
    );
  });

  app.onError((err, c) => {
    const { status, body } = problemJson(err);
    return c.json(body, status as 400);
  });

  const api = new Hono();
  api.use("*", async (c, next) => {
    if (!isBootReady()) {
      return c.json({ code: "service_starting", message: "executor service is not ready" }, 503);
    }
    await next();
  });
  api.use("*", internalAuthMiddleware);
  api.route("/tasks", tasksRoutes);
  api.route("/video-productions", videoProductionRoutes);
  app.route("/", api);

  return app;
}
