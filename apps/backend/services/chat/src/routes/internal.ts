import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { publishArtifactTaskEvent } from "../agent/index.js";
import { internalAuthMiddleware } from "../middleware/internal-auth.js";

export const internalRoutes = new Hono();

internalRoutes.use("*", internalAuthMiddleware);

const taskNotifySchema = z.object({
  taskId: z.string().min(1),
  conversationId: z.string().min(1),
  ownerRef: z.string().min(1),
  type: z.string().min(1),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  progress: z
    .object({ done: z.number().int().min(0), total: z.number().int().min(0) })
    .nullable()
    .optional(),
  result: z.unknown().optional(),
  error: z.string().nullable().optional(),
});

internalRoutes.post(
  "/tasks/notify",
  zValidator("json", taskNotifySchema, (result) => {
    if (!result.success) {
      console.warn("[chat-internal] invalid task notify", result.error.flatten());
    }
  }),
  async (c) => {
    const payload = c.req.valid("json");
    await publishArtifactTaskEvent({
      taskId: payload.taskId,
      status: payload.status,
      progress: payload.progress ?? null,
      result: payload.result,
      error: payload.error ?? null,
    });
    return c.json({ ok: true });
  },
);
