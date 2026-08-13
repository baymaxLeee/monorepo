import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import { zValidator } from "@hono/zod-validator";
import { UI_MESSAGE_STREAM_HEADERS } from "ai";
import { Hono } from "hono";
import { z } from "zod";

import type { BotProfileSnapshot } from "../../../application/agent/context/instructions/index.js";
import {
  createAgentRunResponse,
  getAgentRunTrace,
  cancelRun,
  activeAgentStreamRunId,
  isRunActive,
  replayAgentSseStream,
} from "../../../application/agent/index.js";
import { getConversationRow } from "../../../application/conversations.js";
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
  agent_id: z.string().max(32).optional().nullable(),
  // Ephemeral per-run behavior selector (ADR-0035); not persisted.
  mode: z.enum(["normal", "plan"]).optional(),
});

agentsRoutes.post(
  "/:conversationId/agents/run/stream",
  zValidator("json", runSchema, (result) => {
    if (!result.success) {
      logger.warn({ issues: result.error.flatten() }, "invalid run request");
    }
  }),
  async (c) => {
    const auth = getAuth(c);
    const conversationId = c.req.param("conversationId");
    const payload = c.req.valid("json");

    let textProvider: ProviderSnapshot & LanguageProviderSnapshot;
    let imageProvider: ProviderSnapshot | null = null;
    let videoProviderId: string | null = null;
    let botProfile: BotProfileSnapshot | null = null;
    let botSkills: AgentSkillRef[] = [];
    if (payload.agent_id) {
      const agent = await getAgent(auth.userId, payload.agent_id, auth.orgId);
      textProvider = agent.text ?? (await getProvider(auth.orgId, null));
      imageProvider = agent.image;
      videoProviderId = agent.video?.id ?? null;
      botProfile = agent.profile;
      botSkills = agent.skills;
    } else {
      textProvider = await getProvider(auth.orgId, null);
    }

    return createAgentRunResponse(auth, conversationId, textProvider, [payload.message], {
      imageProvider,
      videoProviderId,
      botProfile,
      botSkills,
      mode: payload.mode,
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

  const encoder = new TextEncoder();
  let cancelled = false;
  const subscriberController = new AbortController();
  c.req.raw.signal.addEventListener("abort", () => subscriberController.abort(), {
    once: true,
  });
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of replayAgentSseStream(conversationId, runId, {
          isRunLive: isRunActive,
          signal: subscriberController.signal,
        })) {
          if (cancelled) {
            return;
          }
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        if (!cancelled) {
          controller.error(error);
        }
        return;
      }
      if (!cancelled) {
        controller.close();
      }
    },
    cancel() {
      cancelled = true;
      subscriberController.abort();
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
