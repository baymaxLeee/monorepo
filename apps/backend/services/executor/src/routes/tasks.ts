import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { cancelTask, createTask, getTask } from "../tasks/service.js";

export const tasksRoutes = new Hono();

const createTaskSchema = z.object({
  type: z.string().min(1).max(64),
  owner_service: z.string().min(1).max(40),
  owner_ref: z.string().min(1).max(80),
  payload: z.unknown(),
});

tasksRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
  const body = c.req.valid("json");
  const task = await createTask({
    type: body.type,
    ownerService: body.owner_service,
    ownerRef: body.owner_ref,
    payload: body.payload,
  });
  return c.json(task, 201);
});

tasksRoutes.get("/:id", async (c) => {
  const task = await getTask(c.req.param("id"));
  return c.json(task);
});

tasksRoutes.post("/:id/cancel", async (c) => {
  const task = await cancelTask(c.req.param("id"));
  return c.json(task);
});

// No GET /:id/stream: it was speculative (built ahead of any real consumer —
// neither chat nor the frontend ever called it) and its chunk format was
// never actually defined. Removed rather than kept "for later" — add it back
// with a concrete shape once a real consumer needs sub-poll-interval
// progress. Polling GET /:id is the only progress channel today and is
// sufficient for the current UX (see ChatArtifactCard.tsx).
