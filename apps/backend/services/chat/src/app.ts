import { Hono } from "hono";

import { problemJson } from "./lib/errors.js";
import { authMiddleware } from "./middleware/auth.js";
import { agentsRoutes } from "./routes/agents.js";
import { conversationsRoutes } from "./routes/conversations.js";
import { internalRoutes } from "./routes/internal.js";
import { memoriesRoutes } from "./routes/memories.js";

export function createApp() {
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ status: "ok" }));
  app.get("/livez", (c) => c.json({ status: "ok" }));
  app.get("/readyz", (c) => c.json({ status: "ok" }));

  app.onError((err, c) => {
    const { status, body } = problemJson(err);
    return c.json(body, status as 400);
  });

  app.route("/internal", internalRoutes);

  const api = new Hono();
  api.use("*", authMiddleware);
  api.route("/conversations", conversationsRoutes);
  api.route("/conversations", agentsRoutes);
  api.route("/memories", memoriesRoutes);
  app.route("/", api);

  return app;
}
