import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";

import { getProvider } from "../clients/admin.js";
import { getTask } from "../clients/executor.js";
import { getAuth } from "../middleware/auth.js";
import {
  createAgentRunResponse,
  getAgentRunTrace,
  cancelRun,
  activeAgentStreamRunId,
  replayAgentSseStream,
} from "../agent/index.js";
import { getConversationRow } from "../services/conversations.js";

export const agentsRoutes = new Hono();

const runSchema = z.object({
  id: z.string().optional(),
  message: z.unknown(),
  provider_id: z.string().max(32).optional().nullable(),
  multimodal_provider_id: z.string().max(32).optional().nullable(),
  document_ids: z.array(z.string()).max(10).optional().default([]),
  thinking: z.boolean().optional().nullable(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional().nullable(),
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
    const provider = await getProvider(auth.userId, payload.provider_id ?? null);

    return createAgentRunResponse(
      auth,
      conversationId,
      provider,
      [payload.message],
      {
        providerId: payload.provider_id,
        multimodalProviderId: payload.multimodal_provider_id,
        documentIds: [...(payload.document_ids ?? [])],
        thinking: payload.thinking,
        reasoningEffort: payload.reasoning_effort,
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
        for await (const chunk of replayAgentSseStream(conversationId, runId)) {
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

// Thin proxy to executor: write_file/edit_file's tool output carries a
// task_id (see ChatArtifactCard on the frontend), which polls this endpoint
// for progress instead of the old "list all unfinished jobs for this
// conversation" endpoint. One task at a time, looked up by id, matches the
// non-blocking dispatch model (agent_task_执行时服务 plan Phase 2).
agentsRoutes.get("/:conversationId/tasks/:taskId", async (c) => {
  const auth = getAuth(c);
  await getConversationRow(auth, c.req.param("conversationId"));
  const task = await getTask(c.req.param("taskId"));
  return c.json(task);
});
