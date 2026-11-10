import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";

import { eq } from "drizzle-orm";

import { createApp } from "../../../bootstrap/app.js";
import { markBootReady } from "../../../infrastructure/health/readiness.js";
import { getDb, getSql } from "../../../infrastructure/persistence/index.js";
import { conversations } from "../../../infrastructure/persistence/schema.js";
import { closeRedisClient, getRedisClient } from "../../../infrastructure/redis/index.js";
import {
  activateAgentStream,
  activeAgentStreamRunId,
  consumeAgentSseStream,
  createAgentReplayResponse,
  deactivateAgentStream,
} from "./service.js";

const enabled = process.env.CHAT_REDIS_INTEGRATION === "1";

function identifier(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

async function cleanup(conversationId: string, ...runIds: string[]): Promise<void> {
  await getRedisClient().del(
    `chat:agent-streams:${conversationId}:active`,
    ...runIds.map((runId) => `chat:agent-streams:${runId}:sse`),
  );
  await getDb().delete(conversations).where(eq(conversations.id, conversationId));
}

after(async () => {
  if (!enabled) return;
  await closeRedisClient();
  await getSql().end();
});

test("active pointer compare-delete cannot clear a newer run", { skip: !enabled }, async () => {
  const conversationId = identifier("cv");
  const oldRunId = identifier("run");
  const newRunId = identifier("run");
  try {
    await activateAgentStream(conversationId, oldRunId);
    assert.equal(await activeAgentStreamRunId(conversationId), oldRunId);
    await activateAgentStream(conversationId, newRunId);
    await deactivateAgentStream(conversationId, oldRunId);
    assert.equal(await activeAgentStreamRunId(conversationId), newRunId);
    await deactivateAgentStream(conversationId, newRunId);
    assert.equal(await activeAgentStreamRunId(conversationId), null);
  } finally {
    await getRedisClient().del(
      `chat:agent-streams:${conversationId}:active`,
      `chat:agent-streams:${oldRunId}:sse`,
      `chat:agent-streams:${newRunId}:sse`,
    );
  }
});

test(
  "native SSE is replayed once and subscriber cancellation interrupts blocking read",
  { skip: !enabled },
  async () => {
    const conversationId = identifier("cv");
    const replayRunId = identifier("run");
    const blockingRunId = identifier("run");
    try {
      await activateAgentStream(conversationId, replayRunId);
      const chunks = ['data: {"type":"start"}\n\n', 'data: {"type":"finish"}\n\n', "data: [DONE]\n\n"];
      await consumeAgentSseStream(
        conversationId,
        replayRunId,
        new ReadableStream<string>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
      );
      assert.equal(await activeAgentStreamRunId(conversationId), null);

      const response = createAgentReplayResponse(conversationId, replayRunId, { isRunLive: async () => false });
      assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
      assert.equal(response.headers.get("x-agent-run-id"), replayRunId);
      assert.equal(await response.text(), chunks.join(""));

      await activateAgentStream(conversationId, blockingRunId);
      const blocking = createAgentReplayResponse(conversationId, blockingRunId, { isRunLive: async () => true });
      const reader = blocking.body?.getReader();
      assert.ok(reader);
      const pendingRead = reader.read();
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 25);
      });
      await Promise.race([
        reader.cancel(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("subscriber cancellation timed out")), 1_000);
        }),
      ]);
      await assert.doesNotReject(pendingRead);
    } finally {
      await getRedisClient().del(
        `chat:agent-streams:${conversationId}:active`,
        `chat:agent-streams:${replayRunId}:sse`,
        `chat:agent-streams:${blockingRunId}:sse`,
      );
    }
  },
);

test("resume endpoint returns 204 when no stream is active", { skip: !enabled }, async () => {
  const conversationId = identifier("cv");
  const userId = identifier("u");
  const tenantId = identifier("t");
  const workspaceId = identifier("w");
  const now = new Date();
  await getDb().insert(conversations).values({
    id: conversationId,
    userId,
    tenantId,
    workspaceId,
    title: "resume 204 integration test",
    model: "test-model",
    providerId: "test-provider",
    createdAt: now,
    updatedAt: now,
  });
  try {
    markBootReady();
    const response = await createApp().request(`/conversations/${conversationId}/agents/run/stream`, {
      headers: {
        "X-Auth-User-ID": userId,
        "X-Auth-Tenant-ID": tenantId,
        "X-Auth-Workspace-ID": workspaceId,
      },
    });
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  } finally {
    await cleanup(conversationId);
  }
});
