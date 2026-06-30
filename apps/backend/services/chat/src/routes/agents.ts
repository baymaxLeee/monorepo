import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";

import { getProvider } from "../clients/admin.js";
import { listUnfinishedArtifactGenerations } from "../clients/knowledge.js";
import { getAuth } from "../middleware/auth.js";
import {
  createAgentRunResponse,
  getAgentRunTrace,
  cancelRun,
  activeAgentStreamRunId,
  replayAgentSseStream,
} from "../services/agent/index.js";
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
  const run = await getAgentRunTrace(auth, conversationId, runId);
  return c.json({
    cancelled: await cancelRun(conversationId, runId),
    status: run.status,
  });
});

agentsRoutes.get("/:conversationId/artifact-jobs", async (c) => {
  const auth = getAuth(c);
  const conversation = await getConversationRow(auth, c.req.param("conversationId"));
  const jobs = await listUnfinishedArtifactGenerations({
    userId: conversation.userId,
    conversationId: conversation.id,
    limit: 20,
  });
  return c.json(jobs);
});
