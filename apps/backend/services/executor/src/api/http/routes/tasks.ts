import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { fileTaskBatchInputSchema } from "../../../../workflows/file-task-batch.js";
import { videoGenerationInputSchema } from "../../../../workflows/video-generation.js";
import { RequestError } from "../../../application/errors.js";
import { requireCallerService } from "../middleware/auth.js";
import { cancelTask, createTask, getTask, type TaskOwner } from "../../../application/tasks/service.js";

export const tasksRoutes = new Hono();

function parseOwner(c: { req: { query: (key: string) => string | undefined } }): TaskOwner {
  const caller = requireCallerService(c as Parameters<typeof requireCallerService>[0]);
  const service = c.req.query("owner_service");
  if (!service || service !== caller) {
    throw new RequestError("owner_service must match X-Caller-Service");
  }
  const ref = c.req.query("owner_ref");
  if (!ref) throw new RequestError("owner_ref query parameter is required");
  return { service, ref };
}

const createTaskEnvelope = {
  owner_service: z.string().min(1).max(40),
  owner_ref: z.string().min(1).max(80),
};

const createTaskSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("file-task-batch"), payload: fileTaskBatchInputSchema, ...createTaskEnvelope }),
  z.object({ type: z.literal("video-generation"), payload: videoGenerationInputSchema, ...createTaskEnvelope }),
]);

tasksRoutes.post("/", zValidator("json", createTaskSchema), async (c) => {
  const caller = requireCallerService(c);
  const body = c.req.valid("json");
  if (body.owner_service !== caller) {
    throw new RequestError("owner_service must match X-Caller-Service");
  }
  const task = await createTask({
    type: body.type,
    ownerService: body.owner_service,
    ownerRef: body.owner_ref,
    payload: body.payload,
  });
  return c.json(task, 201);
});

tasksRoutes.get("/:id", async (c) => {
  const task = await getTask(c.req.param("id"), parseOwner(c));
  return c.json(task);
});

tasksRoutes.post("/:id/cancel", async (c) => {
  const task = await cancelTask(c.req.param("id"), parseOwner(c));
  return c.json(task);
});
