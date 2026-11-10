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
  AGENT_STREAM_MAX_BYTES,
  AgentStreamCapacityError,
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
    const ttl = await getRedisClient().ttl(`chat:agent-streams:${conversationId}:active`);
    assert.ok(ttl > 0 && ttl <= 5 * 60, `expected a short active stream lease, received ${ttl}s`);
    await getRedisClient().xadd(`chat:agent-streams:${oldRunId}:sse`, "*", "sse", "old");
    await activateAgentStream(conversationId, newRunId);
    await deactivateAgentStream(conversationId, oldRunId);
    assert.equal(await activeAgentStreamRunId(conversationId), newRunId);
    assert.equal(await getRedisClient().exists(`chat:agent-streams:${oldRunId}:sse`), 0);
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
  "active native SSE is replayed once, then terminal cleanup removes its Redis cache",
  { skip: !enabled },
  async () => {
    const conversationId = identifier("cv");
    const replayRunId = identifier("run");
    const blockingRunId = identifier("run");
    try {
      await activateAgentStream(conversationId, replayRunId);
      const chunks = ['data: {"type":"start"}\n\n', 'data: {"type":"finish"}\n\n', "data: [DONE]\n\n"];
      let closeReplayStream: (() => void) | undefined;
      const consumption = consumeAgentSseStream(
        conversationId,
        replayRunId,
        new ReadableStream<string>({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            closeReplayStream = () => controller.close();
          },
        }),
      );
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await getRedisClient().xlen(`chat:agent-streams:${replayRunId}:sse`)) === chunks.length) break;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 10);
        });
      }
      assert.equal(await activeAgentStreamRunId(conversationId), replayRunId);

      const response = createAgentReplayResponse(conversationId, replayRunId, { isRunLive: async () => false });
      assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1");
      assert.equal(response.headers.get("x-agent-run-id"), replayRunId);
      assert.equal(await response.text(), chunks.join(""));

      assert.ok(closeReplayStream);
      closeReplayStream();
      await consumption;
      assert.equal(await activeAgentStreamRunId(conversationId), null);
      assert.equal(await getRedisClient().exists(`chat:agent-streams:${replayRunId}:sse`), 0);

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

test("large Unicode SSE chunks are fragmented and replayed byte-for-byte", { skip: !enabled }, async () => {
  const conversationId = identifier("cv");
  const runId = identifier("run");
  const chunks = [`data: ${JSON.stringify({ type: "text", value: "你".repeat(30_000) })}\n\n`, "data: [DONE]\n\n"];
  let closeStream: (() => void) | undefined;
  try {
    await activateAgentStream(conversationId, runId);
    const consumption = consumeAgentSseStream(
      conversationId,
      runId,
      new ReadableStream<string>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          closeStream = () => controller.close();
        },
      }),
    );
    for (let attempt = 0; attempt < 50; attempt++) {
      if ((await getRedisClient().xlen(`chat:agent-streams:${runId}:sse`)) >= 3) break;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    }
    const response = createAgentReplayResponse(conversationId, runId, { isRunLive: async () => true });
    assert.equal(await response.text(), chunks.join(""));
    assert.ok(closeStream);
    closeStream();
    await consumption;
    assert.equal(await getRedisClient().exists(`chat:agent-streams:${runId}:sse`), 0);
  } finally {
    await getRedisClient().del(`chat:agent-streams:${conversationId}:active`, `chat:agent-streams:${runId}:sse`);
  }
});

test("replay capacity overflow stops persistence and removes the active cache", { skip: !enabled }, async () => {
  const conversationId = identifier("cv");
  const runId = identifier("run");
  let exceeded: AgentStreamCapacityError | undefined;
  try {
    await activateAgentStream(conversationId, runId);
    await assert.rejects(
      consumeAgentSseStream(
        conversationId,
        runId,
        new ReadableStream<string>({
          start(controller) {
            controller.enqueue("x".repeat(AGENT_STREAM_MAX_BYTES + 1));
          },
        }),
        {
          onCapacityExceeded(error) {
            exceeded = error;
          },
        },
      ),
      AgentStreamCapacityError,
    );
    assert.equal(exceeded?.runId, runId);
    assert.equal(await activeAgentStreamRunId(conversationId), null);
    assert.equal(await getRedisClient().exists(`chat:agent-streams:${runId}:sse`), 0);
  } finally {
    await getRedisClient().del(`chat:agent-streams:${conversationId}:active`, `chat:agent-streams:${runId}:sse`);
  }
});

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
