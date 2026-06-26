import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { getProvider } from "../clients/admin.js";
import { getAuth } from "../middleware/auth.js";
import {
  assertWorkflowRunVersion,
  cancelWorkflowRun,
  createAgentRunResponse,
  streamWorkflowRun,
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

const cancelSchema = z.object({
  workflow_run_id: z.string().min(1).max(128),
  assistant_message: z.unknown().optional(),
});

agentsRoutes.post("/:conversationId/agents/run/stream", zValidator("json", runSchema), async (c) => {
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
  );
});

agentsRoutes.get("/:conversationId/agents/run/stream/:workflowRunId/stream", async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  const workflowRunId = c.req.param("workflowRunId");
  await assertWorkflowRunVersion(auth, conversationId, workflowRunId);
  const rawStartIndex = c.req.query("startIndex");
  const startIndex =
    rawStartIndex == null || rawStartIndex === "" ? undefined : Number.parseInt(rawStartIndex, 10);
  return streamWorkflowRun(auth, conversationId, workflowRunId, Number.isNaN(startIndex) ? undefined : startIndex);
});

agentsRoutes.post(
  "/:conversationId/agents/run/cancel",
  zValidator("json", cancelSchema),
  async (c) => {
    const auth = getAuth(c);
    const conversationId = c.req.param("conversationId");
    const body = c.req.valid("json");
    await cancelWorkflowRun(auth, conversationId, body.workflow_run_id, body.assistant_message);
    return c.json({ cancelled: true, workflow_run_id: body.workflow_run_id });
  },
);
