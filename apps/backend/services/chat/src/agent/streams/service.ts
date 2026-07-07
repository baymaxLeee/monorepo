import { Redis } from "ioredis";

import { logger } from "../../lib/logger.js";
import { getSettings } from "../../config.js";

type XReadRedis = Redis & {
  xread(...args: Array<string | number>): Promise<[string, [string, string[]][]][] | null>;
};

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
        await appendSseChunk(conversationId, runId, value);
      } catch (error) {
        if (!redisErrorLogged) {
          redisErrorLogged = true;
          logger.error({ err: error }, "resumable stream persistence failed");
        }
      }
    }
  } finally {
    reader.releaseLock();
    await deactivateAgentStream(conversationId, runId).catch((error) =>
      logger.error({ err: error }, "failed to clear resumable stream"),
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

const STALE_CHECK_EVERY_IDLE_ROUNDS = 6;

export interface ReplayAgentStreamOptions {
  isRunLive?: (runId: string) => Promise<boolean>;
  signal?: AbortSignal;
}

export async function* replayAgentSseStream(
  conversationId: string,
  runId: string,
  options?: ReplayAgentStreamOptions,
): AsyncGenerator<string> {
  const reader = getRedis().duplicate();
  const key = streamKey(runId);
  let lastId = "0-0";
  let idleRounds = 0;
  const abortRead = () => reader.disconnect();
  options?.signal?.addEventListener("abort", abortRead, { once: true });
  try {
    while (true) {
      if (options?.signal?.aborted) return;
      const response = await (reader as XReadRedis).xread(
        "BLOCK",
        STREAM_READ_BLOCK_MS,
        "COUNT",
        50,
        "STREAMS",
        key,
        lastId,
      );
      if (options?.signal?.aborted) return;
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
  } catch (error) {
    if (!options?.signal?.aborted) throw error;
  } finally {
    options?.signal?.removeEventListener("abort", abortRead);
    await reader.quit().catch(() => reader.disconnect());
  }
}

function fieldValue(fields: string[], name: string): string | null {
  for (let index = 0; index < fields.length - 1; index += 2) {
    if (fields[index] === name) return fields[index + 1] ?? null;
  }
  return null;
}
