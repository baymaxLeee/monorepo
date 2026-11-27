import { zValidator } from "@hono/zod-validator";
import { validateResolvedSnapshot, type ResolvedTurnPluginSnapshot } from "@repo/agent-runtime";
import { Hono } from "hono";
import { z } from "zod";

import {
  createAgentRunResponse,
  resumeAgentRunResponse,
  getAgentRunTrace,
  cancelRun,
  acceptAgentRunInput,
  getAgentRunInput,
  listAgentRunInputs,
} from "../../../application/agent/index.js";
import type { TurnCapabilities } from "../../../application/agent/runtime/types.js";
import type { ToolCatalog } from "../../../application/agent/tools/catalog.js";
import { callSessionAppTool } from "../../../application/mcp-app-call.js";
import { RequestError } from "../../../application/errors.js";
import { getSessionRow, updateSessionModel } from "../../../application/sessions.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { mediaCapabilitiesSchema } from "../../../infrastructure/provider/capability.js";

export function createAgentsRoutes(dependencies: { toolCatalog: ToolCatalog }) {
  const agentsRoutes = new Hono();

  const providerCapabilitySchema = z
    .object({
      id: z.string().min(1).max(32),
      name: z.string().min(1).max(120),
      model: z.string().min(1).max(120),
      baseUrl: z.url().max(2_048),
      apiKey: z.string().min(1).max(16_384),
      extraBody: z.record(z.string(), z.unknown()),
      contextWindow: z.number().int().positive(),
      maxOutputTokens: z.number().int().nonnegative(),
      supportsImageInput: z.boolean(),
      providerKind: z.string().max(64).optional(),
    })
    .strict();
  const skillFileSchema = z.discriminatedUnion("storageKind", [
    z.object({ storageKind: z.literal("inline"), mimeType: z.string().nullable(), content: z.string() }).strict(),
    z
      .object({
        storageKind: z.literal("asset"),
        mimeType: z.string().nullable(),
        assetId: z.string().min(1),
        revisionId: z.string().min(1),
        sizeBytes: z.number().int().nonnegative(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        url: z.string().min(1),
      })
      .strict(),
  ]);
  const skillSnapshotSchema = z
    .object({
      id: z.string().min(1).max(128),
      name: z.string().min(1).max(128),
      description: z.string().max(4_096),
      body: z.string().min(1).max(1_048_576),
      files: z.record(z.string().min(1).max(1_024), skillFileSchema),
    })
    .strict()
    .refine((skill) => Object.keys(skill.files).length <= 128, "a skill may contain at most 128 files");
  const pluginSnapshotSchema = z.unknown().transform((value, context): ResolvedTurnPluginSnapshot => {
    try {
      validateResolvedSnapshot(value as ResolvedTurnPluginSnapshot);
      return value as ResolvedTurnPluginSnapshot;
    } catch (error) {
      context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "invalid plugin snapshot" });
      return z.NEVER;
    }
  });
  agentsRoutes.post("/:sessionId/mcp-apps/call", zValidator("json", z.object({
    tool_call_id: z.string().min(1), name: z.string().min(1), arguments: z.record(z.string(), z.unknown()), plugins: pluginSnapshotSchema,
  }).strict()), async c => {
    const input = c.req.valid("json");
    c.header("Cache-Control","no-store");
    return c.json(await callSessionAppTool(c.req.param("sessionId"), input.tool_call_id, input.name, input.arguments, input.plugins, c.req.raw.signal));
  });
  const capabilitiesSchema = z
    .object({
      provider: providerCapabilitySchema,
      media: mediaCapabilitiesSchema,
      plugins: pluginSnapshotSchema,
      skills: z.array(skillSnapshotSchema).max(64),
      memories: z
        .array(
          z
            .object({
              id: z.string().min(1).max(32),
              category: z.string().min(1).max(40),
              content: z.string().min(1).max(2_000),
              confidence: z.number().int().min(0).max(100),
            })
            .strict(),
        )
        .max(64),
    })
    .strict();

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
      client_capabilities: z
        .object({
          ui_agent: z.literal("ui-sdk").optional(),
        })
        .strict()
        .optional(),
      capabilities: capabilitiesSchema,
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
    "/:sessionId/stream",
    zValidator("json", runSchema, (result) => {
      if (!result.success) {
        logger.warn({ issues: z.flattenError(result.error) }, "invalid run request");
      }
    }),
    async (c) => {
      const sessionId = c.req.param("sessionId");
      const payload = c.req.valid("json");
      if (payload.id && payload.id !== sessionId) {
        throw new RequestError("chat request id does not match the route session");
      }

      const session = await getSessionRow(sessionId);
      const capabilities = {
        ...payload.capabilities,
        ...(payload.client_capabilities?.ui_agent ? { client: { uiAgent: payload.client_capabilities.ui_agent } } : {}),
      } satisfies TurnCapabilities;
      const textProvider = capabilities.provider;
      const reasoningEffort = session.reasoningEffort as Parameters<typeof updateSessionModel>[1]["reasoningEffort"];
      if (session.providerId !== textProvider.id || session.model !== textProvider.model) {
        await updateSessionModel(sessionId, {
          providerId: textProvider.id,
          model: textProvider.model,
          reasoningEffort,
        });
      }
      return createAgentRunResponse(
        sessionId,
        [payload.message],
        {
          reasoningEffort,
          capabilities,
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

  agentsRoutes.get("/:sessionId/stream", async (c) => resumeAgentRunResponse(c.req.param("sessionId")));

  agentsRoutes.get("/:sessionId/agents/runs/:runId/trace", async (c) => {
    const trace = await getAgentRunTrace(c.req.param("sessionId"), c.req.param("runId"));
    return c.json(trace);
  });

  agentsRoutes.post("/:sessionId/agents/runs/:runId/inputs", zValidator("json", runInputSchema), async (c) => {
    const sessionId = c.req.param("sessionId");
    const runId = c.req.param("runId");
    const payload = c.req.valid("json");
    if (payload.expected_run_id !== runId) throw new RequestError("expected agent run does not match route");
    const input = await acceptAgentRunInput({
      sessionId,
      runId,
      clientMessageId: payload.client_message_id,
      mode: payload.mode,
      text: payload.text,
    });
    return c.json(input, 202);
  });

  agentsRoutes.get("/:sessionId/agents/runs/:runId/inputs", async (c) => {
    const inputs = await listAgentRunInputs({
      sessionId: c.req.param("sessionId"),
      runId: c.req.param("runId"),
    });
    return c.json(inputs);
  });

  agentsRoutes.get("/:sessionId/agents/runs/:runId/inputs/:clientMessageId", async (c) => {
    const input = await getAgentRunInput({
      sessionId: c.req.param("sessionId"),
      runId: c.req.param("runId"),
      clientMessageId: c.req.param("clientMessageId"),
    });
    return c.json(input);
  });

  agentsRoutes.post("/:sessionId/agents/runs/:runId/cancel", async (c) => {
    const sessionId = c.req.param("sessionId");
    const runId = c.req.param("runId");
    await getAgentRunTrace(sessionId, runId);
    const cancelled = await cancelRun(sessionId, runId);
    const run = await getAgentRunTrace(sessionId, runId);
    return c.json({ cancelled, status: run.status });
  });

  return agentsRoutes;
}
