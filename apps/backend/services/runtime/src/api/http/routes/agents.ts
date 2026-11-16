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
  acceptAgentSteeringInput,
  getAgentSteeringInput,
  listAgentSteeringInputs,
  isRunActive,
} from "../../../application/agent/index.js";
import { RequestError } from "../../../application/errors.js";
import { getSessionRow } from "../../../application/sessions.js";
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
  host_context: z
    .object({
      project_id: z.string().min(1).max(36),
      canvas_id: z.string().min(1).max(36),
    })
    .optional(),
  // Ephemeral per-run behavior selector (ADR-0035); not persisted.
  mode: z.enum(["normal", "plan"]).optional(),
});

const steeringSchema = z.object({
  expected_run_id: z.string().min(1).max(32),
  client_message_id: z
    .string()
    .min(8)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/),
  text: z.string().trim().min(1).max(64_000),
  delivery: z.enum(["steer", "queue"]).default("steer"),
});

agentsRoutes.post(
  "/:sessionId/agents/run/stream",
  zValidator("json", runSchema, (result) => {
    if (!result.success) {
      logger.warn({ issues: z.flattenError(result.error) }, "invalid run request");
    }
  }),
  async (c) => {
    const auth = getAuth(c);
    const sessionId = c.req.param("sessionId");
    const payload = c.req.valid("json");
    if (payload.id && payload.id !== sessionId) {
      throw new RequestError("chat request id does not match the route session");
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

    return createAgentRunResponse(auth, sessionId, textProvider, [payload.message], {
      imageProvider,
      videoProviderId,
      botProfile,
      botSkills,
      mode: payload.mode,
      agentId: payload.agent_id,
      projectId: payload.host_context?.project_id,
      canvasId: payload.host_context?.canvas_id,
      trigger: payload.trigger,
      messageId: payload.messageId,
      expectedRevision: payload.expected_revision,
      requestId: payload.request_id,
    });
  },
);

agentsRoutes.get("/:sessionId/agents/run/stream", async (c) => {
  const auth = getAuth(c);
  const sessionId = c.req.param("sessionId");
  await getSessionRow(auth, sessionId);
  const runId = await activeAgentStreamRunId(sessionId);
  if (!runId) {
    return new Response(null, { status: 204 });
  }

  return createAgentReplayResponse(sessionId, runId, {
    isRunLive: isRunActive,
    signal: c.req.raw.signal,
  });
});

agentsRoutes.get("/:sessionId/agents/runs/:runId/trace", async (c) => {
  const trace = await getAgentRunTrace(getAuth(c), c.req.param("sessionId"), c.req.param("runId"));
  return c.json(trace);
});

agentsRoutes.post("/:sessionId/agents/runs/:runId/steer", zValidator("json", steeringSchema), async (c) => {
  const auth = getAuth(c);
  const sessionId = c.req.param("sessionId");
  const runId = c.req.param("runId");
  const payload = c.req.valid("json");
  if (payload.expected_run_id !== runId) throw new RequestError("expected agent run does not match route");
  const input = await acceptAgentSteeringInput({
    sessionId,
    runId,
    userId: auth.userId,
    clientMessageId: payload.client_message_id,
    delivery: payload.delivery,
    text: payload.text,
  });
  return c.json(input, 202);
});

agentsRoutes.get("/:sessionId/agents/runs/:runId/steering-inputs", async (c) => {
  const auth = getAuth(c);
  const inputs = await listAgentSteeringInputs({
    sessionId: c.req.param("sessionId"),
    runId: c.req.param("runId"),
    userId: auth.userId,
  });
  return c.json(inputs);
});

agentsRoutes.get("/:sessionId/agents/runs/:runId/steering-inputs/:clientMessageId", async (c) => {
  const auth = getAuth(c);
  const input = await getAgentSteeringInput({
    sessionId: c.req.param("sessionId"),
    runId: c.req.param("runId"),
    userId: auth.userId,
    clientMessageId: c.req.param("clientMessageId"),
  });
  return c.json(input);
});

agentsRoutes.post("/:sessionId/agents/runs/:runId/cancel", async (c) => {
  const auth = getAuth(c);
  const sessionId = c.req.param("sessionId");
  const runId = c.req.param("runId");
  await getAgentRunTrace(auth, sessionId, runId);
  const cancelled = await cancelRun(sessionId, runId);
  const run = await getAgentRunTrace(auth, sessionId, runId);
  return c.json({ cancelled, status: run.status });
});
