import { timingSafeEqual } from "node:crypto";

import { requestLogger, traceMiddleware } from "@backend/kernel-ts";
import { Hono } from "hono";

import { authMiddleware } from "../api/http/middleware/auth.js";
import { problemJson } from "../api/http/problem.js";
import { agentsRoutes } from "../api/http/routes/agents.js";
import { localInferenceRoutes } from "../api/http/routes/local-inference.js";
import { memoriesRoutes } from "../api/http/routes/memories.js";
import { sessionsRoutes } from "../api/http/routes/sessions.js";
import { checkReadiness, currentBootState, isBootReady } from "../infrastructure/health/readiness.js";
import { logger } from "../infrastructure/observability/logger.js";
import { getServerSettings } from "./server-config.js";

function validChatCaller(headers: Headers): boolean {
  const actual = Buffer.from(headers.get("X-Internal-Token") ?? "");
  const expected = Buffer.from(getServerSettings().chatCallerToken);
  return (
    headers.get("X-Caller-Service") === "chat" && actual.length === expected.length && timingSafeEqual(actual, expected)
  );
}

export function createApp() {
  const app = new Hono();

  app.use("*", traceMiddleware());
  app.use("*", requestLogger(logger));

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
    return c.json(body, status as 400);
  });

  const api = new Hono();
  api.use("*", async (c, next) => {
    if (!isBootReady()) {
      return c.json({ code: "service_starting", message: "runtime server is not ready" }, 503);
    }
    if (!validChatCaller(c.req.raw.headers)) {
      return c.json({ code: "unauthorized", message: "invalid Runtime caller" }, 401);
    }
    await next();
  });
  api.use("*", authMiddleware);
  api.route("/v1/sessions", sessionsRoutes);
  api.route("/v1/sessions", agentsRoutes);
  api.route("/memories", memoriesRoutes);
  api.route("/local-inference", localInferenceRoutes);
  app.route("/", api);

  return app;
}
