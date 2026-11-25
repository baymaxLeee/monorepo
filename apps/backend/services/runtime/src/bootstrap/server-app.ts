import { timingSafeEqual } from "node:crypto";

import { Hono } from "hono";
import type { Logger } from "pino";

import { requestLogger, traceMiddleware } from "#runtime/foundation";

import { problemJson } from "../api/http/problem.js";
import { createAgentsRoutes } from "../api/http/routes/agents.js";
import { localInferenceRoutes } from "../api/http/routes/local-inference.js";
import { sessionsRoutes } from "../api/http/routes/sessions.js";
import { ToolCatalog } from "../application/agent/tools/catalog.js";
import { getServerSettings } from "../config/server.js";
import { checkReadiness, currentBootState, isBootReady } from "../infrastructure/health/readiness.js";
import { logger } from "../infrastructure/observability/logger.js";

export function createApp(dependencies: { toolCatalog?: ToolCatalog; logger?: Logger } = {}) {
  const settings = getServerSettings();
  const toolCatalog = dependencies.toolCatalog ?? new ToolCatalog();
  const appLogger = dependencies.logger ?? logger;
  const app = new Hono();

  app.use("*", traceMiddleware());
  app.use("*", requestLogger(appLogger));

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/livez", (c) =>
    c.json({ status: currentBootState() === "failed" ? "failed" : "ok" }, currentBootState() === "failed" ? 503 : 200),
  );
  app.get("/readyz", async (c) => {
    const report = await checkReadiness();
    return c.json(
      {
        status: report.ok ? "ok" : "degraded",
        boot: report.boot,
        postgres: report.postgres,
        redis: report.redis,
        ...(report.error ? { error: report.error } : {}),
      },
      report.ok ? 200 : 503,
    );
  });

  app.onError((err, c) => {
    const { status, body } = problemJson(err);
    if (status >= 500) {
      appLogger.error({ err, method: c.req.method, path: c.req.path }, "unhandled runtime request error");
    }
    return c.json(body, status as 400);
  });

  const api = new Hono();
  api.use("*", async (c, next) => {
    if (!isBootReady()) {
      return c.json({ code: "service_starting", message: "runtime server is not ready" }, 503);
    }
    const actual = Buffer.from(c.req.header("X-Internal-Token") ?? "");
    const expected = Buffer.from(settings.chatCallerToken);
    const valid =
      c.req.header("X-Caller-Service") === "chat" &&
      actual.length === expected.length &&
      timingSafeEqual(actual, expected);
    if (!valid) return c.json({ code: "unauthorized", message: "invalid Runtime caller" }, 401);
    await next();
  });
  api.route("/v1/sessions", sessionsRoutes);
  api.route("/v1/sessions", createAgentsRoutes({ toolCatalog }));
  api.route("/local-inference", localInferenceRoutes);
  app.route("/", api);

  return app;
}
