import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getProvider } from "../clients/admin.js";
import { listUnfinishedArtifactGenerations } from "../clients/knowledge.js";
import { getAuth } from "../middleware/auth.js";
import {
  createAgentRunResponse,
  getAgentRunTrace,
  cancelRun,
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
      c.req.raw.signal,
    );
  },
);

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
  if (!["running", "cancel_requested"].includes(run.status)) {
    return c.json({ cancelled: false, status: run.status });
  }
  return c.json({ cancelled: await cancelRun(conversationId, runId) });
});

agentsRoutes.get("/:conversationId/artifact-jobs", async (c) => {
  const auth = getAuth(c);
  const conversation = await getConversationRow(auth, c.req.param("conversationId"));
  const jobs = await listUnfinishedArtifactGenerations({
    userId: conversation.userId,
    conversationId: conversation.id,
  });
  return c.json(jobs);
});
