import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { getProvider } from "../clients/admin.js";
import { getAuth } from "../middleware/auth.js";
import {
  createAgentRunResponse,
  getAgentRunTrace,
} from "../services/agent-runtime.js";

export const agentsRoutes = new Hono();

const runSchema = z.object({
  messages: z.array(z.unknown()).min(1),
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
      payload.messages,
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
