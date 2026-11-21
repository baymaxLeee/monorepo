import { zValidator } from "@hono/zod-validator";
import type { PluginActivation } from "@repo/agent-runtime";
import { Hono } from "hono";
import { z } from "zod";

import type { LanguageProviderSnapshot } from "#runtime/provider-model";

import {
  createAgentRunResponse,
  getAgentRunTrace,
  cancelRun,
  activeAgentStreamRunId,
  createAgentReplayResponse,
  acceptAgentRunInput,
  getAgentRunInput,
  listAgentRunInputs,
  isRunActive,
} from "../../../application/agent/index.js";
import type { ToolCatalog } from "../../../application/agent/tools/catalog.js";
import { RequestError } from "../../../application/errors.js";
import { getSessionRow, updateSessionModel } from "../../../application/sessions.js";
import { getProvider, listSkills, type ProviderSnapshot } from "../../../infrastructure/clients/admin.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { getAuth } from "../middleware/auth.js";

export function createAgentsRoutes(dependencies: { toolCatalog: ToolCatalog }) {
  const agentsRoutes = new Hono();

  const runSchema = z
    .object({
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
      generate_title: z.boolean().optional(),
      plugin_activations: z
        .array(
          z
            .object({
              plugin_id: z
                .string()
                .min(3)
                .max(129)
                .regex(/^[a-z0-9._-]+@[a-z0-9._-]+$/),
              bindings: z
                .record(
                  z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
                  z
                    .string()
                    .min(1)
                    .max(256)
                    .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
                )
                .optional(),
            })
            .strict(),
        )
        .max(16)
        .optional(),
    })
    .strict();

  const runInputSchema = z.object({
    expected_run_id: z.string().min(1).max(32),
    client_message_id: z
      .string()
      .min(8)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/),
    text: z.string().trim().min(1).max(64_000),
    mode: z.enum(["follow-up", "next-turn"]).default("follow-up"),
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

      const session = await getSessionRow(auth, sessionId);
      const textProvider: ProviderSnapshot & LanguageProviderSnapshot = await getProvider(
        auth.tenantId,
        auth.workspaceId,
        session.providerId || null,
      );
      const reasoningEffort = session.reasoningEffort as Parameters<typeof updateSessionModel>[2]["reasoningEffort"];
      if (!session.providerId || session.model !== textProvider.model) {
        await updateSessionModel(auth, sessionId, {
          providerId: textProvider.id,
          model: textProvider.model,
          reasoningEffort,
        });
      }
      const skills = await listSkills(auth.tenantId, auth.workspaceId);

      return createAgentRunResponse(
        auth,
        sessionId,
        textProvider,
        [payload.message],
        {
          reasoningEffort,
          skills,
          pluginActivations: payload.plugin_activations?.map(
            (activation): PluginActivation => ({
              pluginId: activation.plugin_id,
              ...(activation.bindings ? { bindings: activation.bindings } : {}),
            }),
          ),
          trigger: payload.trigger,
          messageId: payload.messageId,
          expectedRevision: payload.expected_revision,
          requestId: payload.request_id,
          generateTitle: payload.generate_title,
        },
        dependencies.toolCatalog,
      );
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

  agentsRoutes.post("/:sessionId/agents/runs/:runId/inputs", zValidator("json", runInputSchema), async (c) => {
    const auth = getAuth(c);
    const sessionId = c.req.param("sessionId");
    const runId = c.req.param("runId");
    const payload = c.req.valid("json");
    if (payload.expected_run_id !== runId) throw new RequestError("expected agent run does not match route");
    const input = await acceptAgentRunInput({
      sessionId,
      runId,
      userId: auth.userId,
      clientMessageId: payload.client_message_id,
      mode: payload.mode,
      text: payload.text,
    });
    return c.json(input, 202);
  });

  agentsRoutes.get("/:sessionId/agents/runs/:runId/inputs", async (c) => {
    const auth = getAuth(c);
    const inputs = await listAgentRunInputs({
      sessionId: c.req.param("sessionId"),
      runId: c.req.param("runId"),
      userId: auth.userId,
    });
    return c.json(inputs);
  });

  agentsRoutes.get("/:sessionId/agents/runs/:runId/inputs/:clientMessageId", async (c) => {
    const auth = getAuth(c);
    const input = await getAgentRunInput({
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

  return agentsRoutes;
}
