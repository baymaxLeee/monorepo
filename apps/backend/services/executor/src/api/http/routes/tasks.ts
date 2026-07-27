import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { getRun } from "workflow/api";
import { z } from "zod";

import { fileTaskBatchInputSchema } from "../../../../workflows/file-task-batch.js";
import { videoGenerationInputSchema } from "../../../../workflows/video-generation.js";
import { RequestError } from "../../../application/errors.js";
import {
  cancelTask,
  createTask,
  getTask,
  getTaskWatchSource,
  settleTaskCompletion,
  type TaskOwner,
} from "../../../application/tasks/service.js";
import { getVideoProductionProjection } from "../../../application/video-production/service.js";
import { requireCallerService } from "../middleware/auth.js";

export const tasksRoutes = new Hono();

function parseOwner(c: { req: { query: (key: string) => string | undefined } }): TaskOwner {
  const caller = requireCallerService(c as Parameters<typeof requireCallerService>[0]);
  const service = c.req.query("owner_service");
  if (!service || service !== caller) {
    throw new RequestError("owner_service must match X-Caller-Service");
  }
  const ref = c.req.query("owner_ref");
  if (!ref) {
    throw new RequestError("owner_ref query parameter is required");
  }
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

function terminal(status: string): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

async function taskWatchFrame(id: string, owner: TaskOwner) {
  const source = await getTaskWatchSource(id, owner);
  return {
    source,
    frame: {
      task: source.task,
      production:
        source.task.type === "video-generation"
          ? await getVideoProductionProjection(source.task.id, owner.service)
          : null,
    },
  };
}

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

tasksRoutes.get("/:id/stream", async (c) => {
  const id = c.req.param("id");
  const owner = parseOwner(c);
  const initial = await taskWatchFrame(id, owner);
  return streamSSE(
    c,
    async (stream) => {
      let current = initial;
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify(current.frame) });
      if (terminal(current.frame.task.status) || !current.source.workflowRunId) {
        return;
      }

      const workflowRunId = current.source.workflowRunId;
      const reader = getRun(workflowRunId).getReadable({ startIndex: -1 }).getReader();
      stream.onAbort(() => reader.cancel());
      while (!stream.aborted) {
        const item = await reader.read();
        if (item.done) {
          break;
        }
        const next = await taskWatchFrame(id, owner);
        if (
          next.frame.task.updatedAt !== current.frame.task.updatedAt ||
          next.frame.production?.version !== current.frame.production?.version
        ) {
          current = next;
          await stream.writeSSE({ event: "snapshot", data: JSON.stringify(current.frame) });
        }
        if (terminal(current.frame.task.status)) {
          return;
        }
      }
      if (stream.aborted) {
        return;
      }
      await settleTaskCompletion(id, workflowRunId);
      current = await taskWatchFrame(id, owner);
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify(current.frame) });
    },
    async (error) => {
      console.error("[executor] task status stream failed", { taskId: id, error });
    },
  );
});

tasksRoutes.get("/:id", async (c) => {
  const task = await getTask(c.req.param("id"), parseOwner(c));
  return c.json(task);
});

tasksRoutes.post("/:id/cancel", async (c) => {
  const task = await cancelTask(c.req.param("id"), parseOwner(c));
  return c.json(task);
});
