import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { getProvider } from "../clients/admin.js";
import { getAuth } from "../middleware/auth.js";
import { createAgentRunResponse } from "../services/agent-runtime.js";
import { AgentStreamService } from "../services/agent-streams.js";
import { extractSlotIds } from "../services/agent-tools.js";

export const agentsRoutes = new Hono();

const runSchema = z.object({
  messages: z.array(z.unknown()).min(1),
  provider_id: z.string().max(32).optional().nullable(),
  multimodal_provider_id: z.string().max(32).optional().nullable(),
  document_ids: z.array(z.string()).max(10).optional().default([]),
  thinking: z.boolean().optional().nullable(),
  reasoning_effort: z.enum(["low", "medium", "high"]).optional().nullable(),
});

async function consumeReplayStream(
  streamService: AgentStreamService,
  conversationId: string,
  runId: string,
  stream: ReadableStream<string>,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) await streamService.appendSseChunk(conversationId, runId, value);
    }
  } finally {
    reader.releaseLock();
    await streamService.finishRun(conversationId, runId);
  }
}

function replaySseResponse(chunks: AsyncGenerator<string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
      } finally {
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

function latestPrompt(messages: unknown[]): string {
  const last = [...messages]
    .reverse()
    .find((m): m is { role: string; parts?: Array<{ type: string; text?: string }> } => {
      return typeof m === "object" && m != null && (m as { role?: unknown }).role === "user";
    });
  return (
    last?.parts
      ?.filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("")
      .trim() ?? ""
  );
}

agentsRoutes.post("/:conversationId/agents/run/stream", zValidator("json", runSchema), async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  const payload = c.req.valid("json");
  const streamService = new AgentStreamService(auth);
  const run = await streamService.startRun(conversationId);

  if (!run.started) {
    return replaySseResponse(streamService.streamSseChunks(conversationId, run.runId));
  }

  const provider = await getProvider(auth.userId, payload.provider_id ?? null);
  const documentIds = [...(payload.document_ids ?? [])];
  for (const id of extractSlotIds(latestPrompt(payload.messages))) {
    if (!documentIds.includes(id)) documentIds.push(id);
  }

  return createAgentRunResponse(
    auth,
    conversationId,
    provider,
    payload.messages,
    {
      providerId: payload.provider_id,
      multimodalProviderId: payload.multimodal_provider_id,
      documentIds,
      thinking: payload.thinking,
      reasoningEffort: payload.reasoning_effort,
      abortSignal: c.req.raw.signal,
      isCancelled: () => streamService.isCancelRequested(conversationId, run.runId),
    },
    {
      consumeSseStream: ({ stream }) =>
        consumeReplayStream(streamService, conversationId, run.runId, stream),
    },
  );
});

agentsRoutes.post("/:conversationId/agents/run/cancel", async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  const streamService = new AgentStreamService(auth);
  const runId = await streamService.requestCancel(conversationId);
  return c.json({ cancelled: runId != null, run_id: runId });
});

agentsRoutes.get("/:conversationId/agents/run/stream", async (c) => {
  const auth = getAuth(c);
  const conversationId = c.req.param("conversationId");
  const streamService = new AgentStreamService(auth);
  const runId = await streamService.activeRunId(conversationId);
  if (!runId) return new Response(null, { status: 204 });
  return replaySseResponse(streamService.streamSseChunks(conversationId, runId));
});
