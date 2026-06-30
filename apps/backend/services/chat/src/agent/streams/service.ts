import { Redis } from "ioredis";

import { getSettings } from "../../config.js";

type XReadRedis = Redis & {
  xread(...args: Array<string | number>): Promise<[string, [string, string[]][]][] | null>;
};

// A run lease lasts ten minutes. Keeping orphaned replay data for one hour
// leaves ample reconnect time without turning Redis into durable chat history.
const STREAM_TTL_SECONDS = 60 * 60;
const STREAM_READ_BLOCK_MS = 5_000;

let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    const settings = getSettings();
    redis = new Redis({
      host: settings.redisHost,
      port: settings.redisPort,
      db: settings.redisDb,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }
  return redis;
}

function activeKey(conversationId: string): string {
  return `chat:agent-streams:${conversationId}:active`;
}

function streamKey(runId: string): string {
  return `chat:agent-streams:${runId}:sse`;
}

export async function activateAgentStream(
  conversationId: string,
  runId: string,
): Promise<void> {
  const client = getRedis();
  const key = streamKey(runId);
  await client
    .pipeline()
    .del(key)
    .hset(activeKey(conversationId), {
      run_id: runId,
      started_at_ms: String(Date.now()),
    })
    .expire(activeKey(conversationId), STREAM_TTL_SECONDS)
    .exec();
}

export async function consumeAgentSseStream(
  conversationId: string,
  runId: string,
  stream: ReadableStream<string>,
): Promise<void> {
  const reader = stream.getReader();
  let redisErrorLogged = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      try {
        // Preserve the exact SSE chunk order emitted by AI SDK. Concurrent
        // XADD calls can reorder text/tool deltas under Redis latency.
        await appendSseChunk(conversationId, runId, value);
      } catch (error) {
        if (!redisErrorLogged) {
          redisErrorLogged = true;
          console.error("[chat-agent] resumable stream persistence failed", error);
        }
      }
    }
  } finally {
    reader.releaseLock();
    await deactivateAgentStream(conversationId, runId).catch((error) =>
      console.error("[chat-agent] failed to clear resumable stream", error),
    );
  }
}

async function appendSseChunk(
  conversationId: string,
  runId: string,
  chunk: string,
): Promise<void> {
  const client = getRedis();
  await client
    .pipeline()
    .xadd(streamKey(runId), "*", "sse", chunk)
    .expire(streamKey(runId), STREAM_TTL_SECONDS)
    .expire(activeKey(conversationId), STREAM_TTL_SECONDS)
    .exec();
}

export async function deactivateAgentStream(
  conversationId: string,
  runId: string,
): Promise<void> {
  await getRedis().eval(
    [
      "if redis.call('HGET', KEYS[1], 'run_id') == ARGV[1] then",
      "  return redis.call('DEL', KEYS[1])",
      "end",
      "return 0",
    ].join("\n"),
    1,
    activeKey(conversationId),
    runId,
  );
}

export async function activeAgentStreamRunId(
  conversationId: string,
): Promise<string | null> {
  return (await getRedis().hget(activeKey(conversationId), "run_id")) || null;
}

export async function* replayAgentSseStream(
  conversationId: string,
  runId: string,
): AsyncGenerator<string> {
  // XREAD BLOCK monopolizes a Redis connection. A duplicate is required so a
  // reconnecting subscriber cannot block the writer that feeds this stream.
  const reader = getRedis().duplicate();
  const key = streamKey(runId);
  let lastId = "0-0";
  try {
    while (true) {
      const response = await (reader as XReadRedis).xread(
        "BLOCK",
        STREAM_READ_BLOCK_MS,
        "COUNT",
        50,
        "STREAMS",
        key,
        lastId,
      );
      if (response) {
        for (const [, entries] of response) {
          for (const [entryId, fields] of entries) {
            lastId = entryId;
            const chunk = fieldValue(fields, "sse");
            if (!chunk) continue;
            yield chunk;
            if (chunk.includes("data: [DONE]")) return;
          }
        }
        continue;
      }

      const activeRunId = await activeAgentStreamRunId(conversationId);
      if (activeRunId === runId) continue;

      const tail = await (reader as XReadRedis).xread(
        "COUNT",
        50,
        "STREAMS",
        key,
        lastId,
      );
      if (!tail) return;
      for (const [, entries] of tail) {
        for (const [entryId, fields] of entries) {
          lastId = entryId;
          const chunk = fieldValue(fields, "sse");
          if (!chunk) continue;
          yield chunk;
          if (chunk.includes("data: [DONE]")) return;
        }
      }
      return;
    }
  } finally {
    await reader.quit().catch(() => reader.disconnect());
  }
}

function fieldValue(fields: string[], name: string): string | null {
  for (let index = 0; index < fields.length - 1; index += 2) {
    if (fields[index] === name) return fields[index + 1] ?? null;
  }
  return null;
}
