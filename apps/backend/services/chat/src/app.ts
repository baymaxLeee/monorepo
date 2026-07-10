import { Hono } from "hono";
import { requestLogger, traceMiddleware } from "@backend/kernel-ts";

import { problemJson } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { checkReadiness, currentBootState, isBootReady } from "./lib/readiness.js";
import { authMiddleware } from "./middleware/auth.js";
import { agentsRoutes } from "./routes/agents.js";
import { conversationsRoutes } from "./routes/conversations.js";
import { memoriesRoutes } from "./routes/memories.js";

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
      return c.json({ code: "service_starting", message: "chat service is not ready" }, 503);
    }
    await next();
  });
  api.use("*", authMiddleware);
  api.route("/conversations", conversationsRoutes);
  api.route("/conversations", agentsRoutes);
  api.route("/memories", memoriesRoutes);
  app.route("/", api);

  return app;
}
