import { UI_MESSAGE_STREAM_HEADERS } from "ai";

import { logger } from "../../../infrastructure/observability/logger.js";
import { getRedisClient } from "../../../infrastructure/redis/index.js";

type XReadRedis = ReturnType<typeof getRedisClient> & {
  xread(...args: Array<string | number>): Promise<[string, [string, string[]][]][] | null>;
};

const STREAM_TTL_SECONDS = 5 * 60;
const STREAM_HEARTBEAT_MS = 60_000;
const STREAM_READ_BLOCK_MS = 5_000;
const STREAM_FRAGMENT_MAX_BYTES = 64 * 1_024;
export const AGENT_STREAM_MAX_BYTES = 8 * 1_024 * 1_024;
export const AGENT_STREAM_MAX_ENTRIES = 10_000;

export class AgentStreamCapacityError extends Error {
  constructor(readonly runId: string) {
    super(`agent stream ${runId} exceeded its Redis replay capacity`);
    this.name = "AgentStreamCapacityError";
  }
}

function activeKey(conversationId: string): string {
  return `chat:agent-streams:${conversationId}:active`;
}

function streamKey(runId: string): string {
  return `chat:agent-streams:${runId}:sse`;
}

export async function activateAgentStream(conversationId: string, runId: string): Promise<void> {
  const client = getRedisClient();
  const key = streamKey(runId);
  await client
    .pipeline()
    .del(key)
    .hset(activeKey(conversationId), {
      run_id: runId,
      started_at_ms: String(Date.now()),
      bytes: "0",
      entries: "0",
    })
    .expire(activeKey(conversationId), STREAM_TTL_SECONDS)
    .exec();
}

export async function consumeAgentSseStream(
  conversationId: string,
  runId: string,
  stream: ReadableStream<string>,
  options?: { onCapacityExceeded?: (error: AgentStreamCapacityError) => void | Promise<void> },
): Promise<void> {
  const reader = stream.getReader();
  let redisErrorLogged = false;
  const heartbeat = setInterval(() => {
    void refreshAgentStreamLease(conversationId, runId).catch((error) => {
      if (!redisErrorLogged) {
        redisErrorLogged = true;
        logger.error({ err: error }, "resumable stream lease refresh failed");
      }
    });
  }, STREAM_HEARTBEAT_MS);
  heartbeat.unref();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      try {
        await appendSseChunk(conversationId, runId, value);
      } catch (error) {
        if (error instanceof AgentStreamCapacityError) {
          await options?.onCapacityExceeded?.(error);
          await reader.cancel(error).catch(() => undefined);
          throw error;
        }
        if (!redisErrorLogged) {
          redisErrorLogged = true;
          logger.error({ err: error }, "resumable stream persistence failed");
        }
      }
    }
  } finally {
    clearInterval(heartbeat);
    reader.releaseLock();
    await deactivateAgentStream(conversationId, runId).catch((error) =>
      logger.error({ err: error }, "failed to clear resumable stream"),
    );
  }
}

async function appendSseChunk(conversationId: string, runId: string, chunk: string): Promise<void> {
  const byteCount = Buffer.byteLength(chunk, "utf8");
  if (byteCount > AGENT_STREAM_MAX_BYTES) throw new AgentStreamCapacityError(runId);
  const fragments = splitSseChunk(chunk);
  const client = getRedisClient();
  const result = await client.eval(
    [
      "if redis.call('HGET', KEYS[1], 'run_id') ~= ARGV[1] then return -2 end",
      "local next_bytes = tonumber(redis.call('HGET', KEYS[1], 'bytes') or '0') + tonumber(ARGV[5])",
      "local next_entries = tonumber(redis.call('HGET', KEYS[1], 'entries') or '0') + tonumber(ARGV[6])",
      "if next_bytes > tonumber(ARGV[3]) or next_entries > tonumber(ARGV[4]) then return -1 end",
      "for index = 7, #ARGV do",
      "  redis.call('XADD', KEYS[2], 'MAXLEN', '~', ARGV[4], '*', 'sse', ARGV[index])",
      "end",
      "redis.call('HSET', KEYS[1], 'bytes', next_bytes, 'entries', next_entries)",
      "redis.call('EXPIRE', KEYS[1], ARGV[2])",
      "redis.call('EXPIRE', KEYS[2], ARGV[2])",
      "return 1",
    ].join("\n"),
    2,
    activeKey(conversationId),
    streamKey(runId),
    runId,
    STREAM_TTL_SECONDS,
    AGENT_STREAM_MAX_BYTES,
    AGENT_STREAM_MAX_ENTRIES,
    byteCount,
    fragments.length,
    ...fragments,
  );
  if (result === -1) {
    throw new AgentStreamCapacityError(runId);
  }
  if (result !== 1) {
    throw new Error(`agent stream ${runId} is no longer active`);
  }
}

function splitSseChunk(chunk: string): string[] {
  if (Buffer.byteLength(chunk, "utf8") <= STREAM_FRAGMENT_MAX_BYTES) return [chunk];
  const fragments: string[] = [];
  let fragment = "";
  let fragmentBytes = 0;
  for (const character of chunk) {
    const characterBytes = Buffer.byteLength(character, "utf8");
    if (fragment && fragmentBytes + characterBytes > STREAM_FRAGMENT_MAX_BYTES) {
      fragments.push(fragment);
      fragment = "";
      fragmentBytes = 0;
    }
    fragment += character;
    fragmentBytes += characterBytes;
  }
  if (fragment) fragments.push(fragment);
  return fragments;
}

async function refreshAgentStreamLease(conversationId: string, runId: string): Promise<void> {
  await getRedisClient().eval(
    [
      "if redis.call('HGET', KEYS[1], 'run_id') ~= ARGV[1] then return 0 end",
      "redis.call('EXPIRE', KEYS[1], ARGV[2])",
      "if redis.call('EXISTS', KEYS[2]) == 1 then redis.call('EXPIRE', KEYS[2], ARGV[2]) end",
      "return 1",
    ].join("\n"),
    2,
    activeKey(conversationId),
    streamKey(runId),
    runId,
    STREAM_TTL_SECONDS,
  );
}

export async function deactivateAgentStream(conversationId: string, runId: string): Promise<void> {
  await getRedisClient().eval(
    [
      "redis.call('DEL', KEYS[2])",
      "if redis.call('HGET', KEYS[1], 'run_id') == ARGV[1] then",
      "  return redis.call('DEL', KEYS[1])",
      "end",
      "return 0",
    ].join("\n"),
    2,
    activeKey(conversationId),
    streamKey(runId),
    runId,
  );
}

export async function activeAgentStreamRunId(conversationId: string): Promise<string | null> {
  return (await getRedisClient().hget(activeKey(conversationId), "run_id")) || null;
}

const STALE_CHECK_EVERY_IDLE_ROUNDS = 6;

export interface ReplayAgentStreamOptions {
  isRunLive?: (runId: string) => Promise<boolean>;
  signal?: AbortSignal;
  /** Redis stream cursor; omit for full replay, `"$"` for tail-only (no history). */
  startAfterId?: string;
}

export async function* replayAgentSseStream(
  conversationId: string,
  runId: string,
  options?: ReplayAgentStreamOptions,
): AsyncGenerator<string> {
  const reader = getRedisClient().duplicate();
  const key = streamKey(runId);
  let lastId = options?.startAfterId ?? "0-0";
  let idleRounds = 0;
  const abortRead = () => reader.disconnect();
  options?.signal?.addEventListener("abort", abortRead, { once: true });
  try {
    while (true) {
      if (options?.signal?.aborted) {
        return;
      }
      const response = await (reader as XReadRedis).xread(
        "BLOCK",
        STREAM_READ_BLOCK_MS,
        "COUNT",
        50,
        "STREAMS",
        key,
        lastId,
      );
      if (options?.signal?.aborted) {
        return;
      }
      if (response) {
        idleRounds = 0;
        for (const [, entries] of response) {
          for (const [entryId, fields] of entries) {
            lastId = entryId;
            const chunk = fieldValue(fields, "sse");
            if (!chunk) {
              continue;
            }
            yield chunk;
            if (chunk.includes("data: [DONE]")) {
              return;
            }
          }
        }
        continue;
      }

      const activeRunId = await activeAgentStreamRunId(conversationId);
      let stillActive = activeRunId === runId;
      if (!stillActive && options?.isRunLive) {
        stillActive = await options.isRunLive(runId).catch(() => false);
      }
      if (stillActive && options?.isRunLive) {
        idleRounds += 1;
        if (idleRounds % STALE_CHECK_EVERY_IDLE_ROUNDS === 0 && !(await options.isRunLive(runId).catch(() => true))) {
          stillActive = false;
        }
      }
      if (stillActive) {
        continue;
      }

      const tail = await (reader as XReadRedis).xread("COUNT", 50, "STREAMS", key, lastId);
      if (!tail) {
        return;
      }
      for (const [, entries] of tail) {
        for (const [entryId, fields] of entries) {
          lastId = entryId;
          const chunk = fieldValue(fields, "sse");
          if (!chunk) {
            continue;
          }
          yield chunk;
          if (chunk.includes("data: [DONE]")) {
            return;
          }
        }
      }
      return;
    }
  } catch (error) {
    if (!options?.signal?.aborted) {
      throw error;
    }
  } finally {
    options?.signal?.removeEventListener("abort", abortRead);
    await reader.quit().catch(() => reader.disconnect());
  }
}

export function createAgentReplayResponse(
  conversationId: string,
  runId: string,
  options: { isRunLive: (runId: string) => Promise<boolean>; signal?: AbortSignal },
): Response {
  const encoder = new TextEncoder();
  const subscriberController = new AbortController();
  options.signal?.addEventListener("abort", () => subscriberController.abort(), { once: true });
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of replayAgentSseStream(conversationId, runId, {
          isRunLive: options.isRunLive,
          signal: subscriberController.signal,
        })) {
          if (cancelled) return;
          controller.enqueue(encoder.encode(chunk));
        }
        if (!cancelled) controller.close();
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
      subscriberController.abort();
    },
  });
  return new Response(body, {
    headers: { ...UI_MESSAGE_STREAM_HEADERS, "x-agent-run-id": runId },
  });
}

function fieldValue(fields: string[], name: string): string | null {
  for (let index = 0; index < fields.length - 1; index += 2) {
    if (fields[index] === name) {
      return fields[index + 1] ?? null;
    }
  }
  return null;
}
