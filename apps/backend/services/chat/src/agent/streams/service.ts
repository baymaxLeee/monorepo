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

// Between BLOCK timeouts with no new chunk, keep trusting the Redis "active"
// flag for this many idle rounds before re-verifying against the run's own
// source of truth. A writer that crashed/restarted never clears the flag
// itself (see reconcileOrphanedRuns), so without this the flag's own TTL —
// scoped for legitimate reconnect gaps, not liveness — is the only bound,
// and that can be up to an hour. ~30s (6 * 5s BLOCK) catches a dead run
// promptly without adding a query to every single idle poll.
const STALE_CHECK_EVERY_IDLE_ROUNDS = 6;

export interface ReplayAgentStreamOptions {
  // Cross-checks the run's actual persisted status. Optional so this module
  // stays a plain Redis transport with no knowledge of the agent_runs schema
  // — the caller (the run/lease layer) supplies the check.
  isRunLive?: (runId: string) => Promise<boolean>;
}

export async function* replayAgentSseStream(
  conversationId: string,
  runId: string,
  options?: ReplayAgentStreamOptions,
): AsyncGenerator<string> {
  // XREAD BLOCK monopolizes a Redis connection. A duplicate is required so a
  // reconnecting subscriber cannot block the writer that feeds this stream.
  const reader = getRedis().duplicate();
  const key = streamKey(runId);
  let lastId = "0-0";
  let idleRounds = 0;
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
        idleRounds = 0;
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
      let stillActive = activeRunId === runId;
      if (stillActive && options?.isRunLive) {
        idleRounds += 1;
        if (
          idleRounds % STALE_CHECK_EVERY_IDLE_ROUNDS === 0 &&
          !(await options.isRunLive(runId).catch(() => true))
        ) {
          stillActive = false;
        }
      }
      if (stillActive) continue;

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

// ---------------------------------------------------------------------------
// Task-scoped streams (executor -> chat -> browser)
//
// The same Redis Streams transport as agent runs, keyed by taskId instead of
// runId. A background executor task pushes native UIMessage SSE frames here via
// /internal/tasks/notify; the browser's ArtifactTaskCard replays them through
// AI SDK's readUIMessageStream. This is deliberately NOT a second streaming
// stack — it reuses the exact XADD/XREAD replay shape so the future migration
// to ai-resumable-stream (ADR-0013 Phase 2) moves both at once.
// ---------------------------------------------------------------------------

export const SSE_DONE_FRAME = "data: [DONE]\n\n";

export function encodeSseData(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function taskStreamKey(taskId: string): string {
  return `chat:task-streams:${taskId}:sse`;
}

function taskActiveKey(taskId: string): string {
  return `chat:task-streams:${taskId}:active`;
}

// Marks the writer as alive so replay does not exit early during quiet gaps
// between progress events. Terminal events clear it (see closeTaskSseStream).
export async function markTaskStreamActive(taskId: string): Promise<void> {
  await getRedis()
    .pipeline()
    .set(taskActiveKey(taskId), "1")
    .expire(taskActiveKey(taskId), STREAM_TTL_SECONDS)
    .exec();
}

export async function appendTaskSseFrame(taskId: string, frame: string): Promise<void> {
  const client = getRedis();
  await client
    .pipeline()
    .xadd(taskStreamKey(taskId), "*", "sse", frame)
    .expire(taskStreamKey(taskId), STREAM_TTL_SECONDS)
    .set(taskActiveKey(taskId), "1")
    .expire(taskActiveKey(taskId), STREAM_TTL_SECONDS)
    .exec();
}

// Appends the terminal sentinel and clears the active flag so any replay loop
// blocked on XREAD returns promptly.
export async function closeTaskSseStream(taskId: string): Promise<void> {
  const client = getRedis();
  await client
    .pipeline()
    .xadd(taskStreamKey(taskId), "*", "sse", SSE_DONE_FRAME)
    .expire(taskStreamKey(taskId), STREAM_TTL_SECONDS)
    .del(taskActiveKey(taskId))
    .exec();
}

async function taskStreamActive(taskId: string): Promise<boolean> {
  return (await getRedis().exists(taskActiveKey(taskId))) === 1;
}

export async function* replayTaskSseStream(taskId: string): AsyncGenerator<string> {
  const reader = getRedis().duplicate();
  const key = taskStreamKey(taskId);
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
            if (chunk.includes("[DONE]")) return;
          }
        }
        continue;
      }

      if (await taskStreamActive(taskId)) continue;

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
          if (chunk.includes("[DONE]")) return;
        }
      }
      return;
    }
  } finally {
    await reader.quit().catch(() => reader.disconnect());
  }
}
