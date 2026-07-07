import { Hono } from "hono";

import { requestLogger, traceMiddleware } from "@backend/kernel-ts";

import { problemJson } from "./lib/errors.js";
import { logger } from "./lib/logger.js";
import { internalAuthMiddleware } from "./middleware/auth.js";
import { tasksRoutes } from "./routes/tasks.js";

export function createApp() {
  const app = new Hono();

  app.use("*", traceMiddleware());
  app.use("*", requestLogger(logger));

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/livez", (c) => c.json({ status: "ok" }));
  app.get("/readyz", (c) => c.json({ status: "ok" }));

  app.onError((err, c) => {
    const { status, body } = problemJson(err);
    return c.json(body, status as 400);
  });

  const api = new Hono();
  api.use("*", internalAuthMiddleware);
  api.route("/tasks", tasksRoutes);
  app.route("/", api);

  return app;
}
