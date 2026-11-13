import type { BotProfileSnapshot } from "@backend/agent-runtime-ts/instructions/index";
import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import {
  createAgentRunResponse,
  getAgentRunTrace,
  cancelRun,
  activeAgentStreamRunId,
  createAgentReplayResponse,
  isRunActive,
} from "../../../application/agent/index.js";
import { getConversationRow } from "../../../application/conversations.js";
import { RequestError } from "../../../application/errors.js";
import {
  type AgentSkillRef,
  getAgent,
  getProvider,
  type ProviderSnapshot,
} from "../../../infrastructure/clients/admin.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { getAuth } from "../middleware/auth.js";

export const agentsRoutes = new Hono();

const runSchema = z.object({
  id: z.string().optional(),
  message: z.unknown(),
  trigger: z.enum(["submit-message", "regenerate-message"]),
  messageId: z.string().min(1).max(32).optional(),
  expected_revision: z.number().int().nonnegative(),
  request_id: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  agent_id: z.string().max(32).optional().nullable(),
  // Ephemeral per-run behavior selector (ADR-0035); not persisted.
  mode: z.enum(["normal", "plan"]).optional(),
});

agentsRoutes.post(
  "/:conversationId/agents/run/stream",
  zValidator("json", runSchema, (result) => {
    if (!result.success) {
      logger.warn({ issues: z.flattenError(result.error) }, "invalid run request");
    }
  }),
  async (c) => {
    const auth = getAuth(c);
    const conversationId = c.req.param("conversationId");
    const payload = c.req.valid("json");
    if (payload.id && payload.id !== conversationId) {
      throw new RequestError("chat request id does not match the route conversation");
    }

    let textProvider: ProviderSnapshot & LanguageProviderSnapshot;
    let imageProvider: ProviderSnapshot | null = null;
    let videoProviderId: string | null = null;
    let botProfile: BotProfileSnapshot | null = null;
    let botSkills: AgentSkillRef[] = [];
    if (payload.agent_id) {
      const agent = await getAgent(auth.userId, payload.agent_id, auth.tenantId, auth.workspaceId);
      textProvider = agent.text ?? (await getProvider(auth.tenantId, auth.workspaceId, null));
      imageProvider = agent.image;
      videoProviderId = agent.video?.id ?? null;
      botProfile = agent.profile;
      botSkills = agent.skills;
    } else {
      textProvider = await getProvider(auth.tenantId, auth.workspaceId, null);
    }

    return createAgentRunResponse(auth, conversationId, textProvider, [payload.message], {
      imageProvider,
      videoProviderId,
      botProfile,
      botSkills,
      mode: payload.mode,
      agentId: payload.agent_id,
      trigger: payload.trigger,
      messageId: payload.messageId,
      expectedRevision: payload.expected_revision,
      requestId: payload.request_id,
    });
  },
);

agentsRoutes.get("/:conversationId/agents/run/stream", async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  await getConversationRow(auth, conversationId);
  const runId = await activeAgentStreamRunId(conversationId);
  if (!runId) {
    return new Response(null, { status: 204 });
  }

  return createAgentReplayResponse(conversationId, runId, {
    isRunLive: isRunActive,
    signal: c.req.raw.signal,
  });
});

agentsRoutes.get("/:conversationId/agents/runs/:runId/trace", async (c) => {
  const trace = await getAgentRunTrace(getAuth(c), c.req.param("conversationId"), c.req.param("runId"));
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
