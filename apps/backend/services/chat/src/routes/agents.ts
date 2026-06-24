import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { getProvider } from "../clients/admin.js";
import { getAuth } from "../middleware/auth.js";
import { streamAgentRun } from "../services/agent-runtime.js";
import { AgentStreamService } from "../services/agent-streams.js";
import { extractSlotIds } from "../services/agent-tools.js";

export const agentsRoutes = new Hono();

const runSchema = z.object({
  prompt: z.string().min(1).max(8000),
  provider_id: z.string().max(32).optional().nullable(),
  multimodal_provider_id: z.string().max(32).optional().nullable(),
  document_ids: z.array(z.string()).max(10).optional().default([]),
  thinking: z.boolean().optional().nullable(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional().nullable(),
});

function sseStream(events: AsyncGenerator<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

agentsRoutes.post("/:conversationId/agents/run/stream", zValidator("json", runSchema), async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  const payload = c.req.valid("json");
  const streamService = new AgentStreamService(auth);
  const run = await streamService.startRun(conversationId);

  if (run.started) {
    void (async () => {
      try {
        const provider = await getProvider(auth.userId, payload.provider_id ?? null);
        const documentIds = [...(payload.document_ids ?? [])];
        for (const id of extractSlotIds(payload.prompt)) {
          if (!documentIds.includes(id)) documentIds.push(id);
        }
        for await (const event of streamAgentRun(auth, conversationId, provider, {
          prompt: payload.prompt,
          providerId: payload.provider_id,
          multimodalProviderId: payload.multimodal_provider_id,
          documentIds,
          thinking: payload.thinking,
          reasoningEffort: payload.reasoning_effort,
        })) {
          await streamService.appendEvent(conversationId, run.runId, event);
        }
      } catch (err) {
        await streamService.appendEvent(conversationId, run.runId, {
          type: "message",
          role: "assistant",
          status: "failed",
          text: String(err),
        });
      } finally {
        await streamService.finishRun(conversationId, run.runId);
      }
    })();
  }

  const events = (async function* () {
    const svc = new AgentStreamService(auth);
    for await (const event of svc.streamEvents(conversationId, run.runId)) {
      yield event;
    }
  })();
  return sseStream(events);
});

agentsRoutes.get("/:conversationId/agents/run/stream", async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  const streamService = new AgentStreamService(auth);
  const runId = await streamService.activeRunId(conversationId);
  if (!runId) {
    return sseStream(
      (async function* () {
        return;
      })(),
    );
  }
  return sseStream(streamService.streamEvents(conversationId, runId));
});
