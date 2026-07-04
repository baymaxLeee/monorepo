import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";

import { getAgent, getProvider, type ProviderSnapshot } from "../clients/admin.js";
import { getTask } from "../clients/executor.js";
import { getAuth } from "../middleware/auth.js";
import {
  createAgentRunResponse,
  getAgentRunTrace,
  cancelRun,
  activeAgentStreamRunId,
  isRunActive,
  replayAgentSseStream,
  markTaskStreamActive,
  replayTaskSseStream,
  taskSeedFrames,
  SSE_DONE_FRAME,
} from "../agent/index.js";
import { getConversationRow } from "../services/conversations.js";

export const agentsRoutes = new Hono();

const runSchema = z.object({
  id: z.string().optional(),
  message: z.unknown(),
  agent_id: z.string().max(32).optional().nullable(),
});

agentsRoutes.post(
  "/:conversationId/agents/run/stream",
  zValidator("json", runSchema, (result) => {
    if (!result.success) {
      console.warn("[chat-agent] invalid run request", result.error.flatten());
    }
  }),
  async (c) => {
    const auth = getAuth(c);
    const conversationId = c.req.param("conversationId");
    const payload = c.req.valid("json");

    let textProvider: ProviderSnapshot;
    let imageProvider: ProviderSnapshot | null = null;
    let videoProviderId: string | null = null;
    if (payload.agent_id) {
      const agent = await getAgent(auth.userId, payload.agent_id);
      textProvider = agent.text ?? (await getProvider(auth.userId, null));
      imageProvider = agent.image;
      videoProviderId = agent.video?.id ?? null;
    } else {
      textProvider = await getProvider(auth.userId, null);
    }

    return createAgentRunResponse(
      auth,
      conversationId,
      textProvider,
      [payload.message],
      {
        imageProvider,
        videoProviderId,
      },
    );
  },
);

agentsRoutes.get("/:conversationId/agents/run/stream", async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  await getConversationRow(auth, conversationId);
  const runId = await activeAgentStreamRunId(conversationId);
  if (!runId) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of replayAgentSseStream(conversationId, runId, { isRunLive: isRunActive })) {
          if (cancelled) return;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        if (!cancelled) controller.error(error);
        return;
      }
      if (!cancelled) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(body, {
    headers: {
      ...UI_MESSAGE_STREAM_HEADERS,
      "x-agent-run-id": runId,
    },
  });
});

agentsRoutes.get("/:conversationId/agents/runs/:runId/trace", async (c) => {
  const trace = await getAgentRunTrace(
    getAuth(c),
    c.req.param("conversationId"),
    c.req.param("runId"),
  );
  return c.json(trace);
});

agentsRoutes.post("/:conversationId/agents/runs/:runId/cancel", async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  const runId = c.req.param("runId");
  await getAgentRunTrace(auth, conversationId, runId);
  const cancelled = await cancelRun(conversationId, runId);
  const run = await getAgentRunTrace(auth, conversationId, runId);
  return c.json({ cancelled, status: run.status });
});

agentsRoutes.get("/:conversationId/tasks/:taskId/stream", async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  const taskId = c.req.param("taskId");
  await getConversationRow(auth, conversationId);
  const task = await getTask(taskId);

  const seed = taskSeedFrames({
    taskId: task.id,
    status: task.status,
    progress: task.progress ?? null,
    result: task.result,
    error: task.error,
  });

  const encoder = new TextEncoder();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const frame of seed.frames) {
          controller.enqueue(encoder.encode(frame));
        }
        if (seed.terminal) {
          controller.enqueue(encoder.encode(SSE_DONE_FRAME));
          controller.close();
          return;
        }
        await markTaskStreamActive(taskId);
        for await (const frame of replayTaskSseStream(taskId)) {
          if (cancelled) return;
          controller.enqueue(encoder.encode(frame));
        }
      } catch (error) {
        if (!cancelled) controller.error(error);
        return;
      }
      if (!cancelled) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  return new Response(body, { headers: { ...UI_MESSAGE_STREAM_HEADERS } });
});

agentsRoutes.get("/:conversationId/tasks/:taskId", async (c) => {
  const auth = getAuth(c);
  await getConversationRow(auth, c.req.param("conversationId"));
  const task = await getTask(c.req.param("taskId"));
  return c.json(task);
});
