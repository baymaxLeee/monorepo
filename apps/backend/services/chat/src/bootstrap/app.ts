import { requestLogger, traceMiddleware } from "@backend/kernel-ts";
import { Hono } from "hono";

import { authMiddleware } from "../api/http/middleware/auth.js";
import { errorResponse } from "../api/http/problem.js";
import { conversationsRoutes } from "../api/http/routes/conversations.js";
import { localInferenceRoutes, memoriesRoutes } from "../api/http/routes/runtime-proxy.js";
import { checkReadiness, currentBootState, isBootReady } from "../infrastructure/health/readiness.js";
import { logger } from "../infrastructure/observability/logger.js";

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
    return c.json(report, report.ok ? 200 : 503);
  });
  app.onError((error) => errorResponse(error));

  const api = new Hono();
  api.use("*", async (c, next) => {
    if (!isBootReady()) {
      return c.json({ code: "service_starting", message: "chat service is not ready" }, 503);
    }
    await next();
  });
  api.use("*", authMiddleware);
  api.route("/conversations", conversationsRoutes);
  api.route("/memories", memoriesRoutes);
  api.route("/local-inference", localInferenceRoutes);
  app.route("/", api);

  return app;
}
