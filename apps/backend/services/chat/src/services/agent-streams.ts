import { Redis } from "ioredis";

import { getSettings } from "../config.js";
import { getConversationRow } from "./conversations.js";
import type { AuthContext } from "../middleware/auth.js";

const STREAM_BLOCK_MS = 100;

type XReadRedis = Redis & {
  xread(...args: Array<string | number>): Promise<[string, [string, string[]][]][] | null>;
};

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const s = getSettings();
    redis = new Redis({ host: s.redisHost, port: s.redisPort, db: s.redisDb });
  }
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

function activeKey(conversationId: string): string {
  return `chat:agent-runs:${conversationId}:active`;
}

function streamKey(conversationId: string, runId: string): string {
  return `chat:agent-runs:${conversationId}:${runId}:events`;
}

function nowMs(): number {
  return Date.now();
}

export interface AgentStreamRun {
  runId: string;
  started: boolean;
}

export class AgentStreamService {
  constructor(private readonly auth: AuthContext) {}

  async ensureConversation(conversationId: string): Promise<void> {
    await getConversationRow(this.auth, conversationId);
  }

  async startRun(conversationId: string): Promise<AgentStreamRun> {
    await this.ensureConversation(conversationId);
    const r = getRedis();
    const active = activeKey(conversationId);
    const live = await this.liveRunId(conversationId);
    if (live) return { runId: live, started: false };

    const runId = crypto.randomUUID().replace(/-/g, "");
    const stream = streamKey(conversationId, runId);
    await r.del(stream);
    await r.hset(active, {
      run_id: runId,
      status: "running",
      started_at_ms: String(nowMs()),
      last_event_at_ms: "",
    });
    return { runId, started: true };
  }

  async activeRunId(conversationId: string): Promise<string | null> {
    await this.ensureConversation(conversationId);
    return this.liveRunId(conversationId);
  }

  /** Fast path for high-frequency text deltas (resume replay only). */
  async appendEventDelta(
    conversationId: string,
    runId: string,
    event: Record<string, unknown>,
  ): Promise<void> {
    const r = getRedis();
    await r.xadd(streamKey(conversationId, runId), "*", "event", JSON.stringify(event));
  }

  async appendEvent(conversationId: string, runId: string, event: Record<string, unknown>): Promise<void> {
    const r = getRedis();
    const stream = streamKey(conversationId, runId);
    const active = activeKey(conversationId);
    const ts = String(nowMs());
    await r
      .pipeline()
      .xadd(stream, "*", "event", JSON.stringify(event))
      .hset(active, { last_event_at_ms: ts })
      .exec();
  }

  async appendSseChunk(conversationId: string, runId: string, chunk: string): Promise<void> {
    const r = getRedis();
    const stream = streamKey(conversationId, runId);
    const active = activeKey(conversationId);
    const ts = String(nowMs());
    await r
      .pipeline()
      .xadd(stream, "*", "sse", chunk)
      .hset(active, { last_event_at_ms: ts })
      .exec();
  }

  async *streamSseChunks(conversationId: string, runId: string): AsyncGenerator<string> {
    const r = getRedis();
    const stream = streamKey(conversationId, runId);
    let lastId = "0-0";

    while (true) {
      const response = await (r as XReadRedis).xread(
        "BLOCK",
        STREAM_BLOCK_MS,
        "COUNT",
        50,
        "STREAMS",
        stream,
        lastId,
      );
      if (!response) {
        if (!(await this.isActive(conversationId, runId))) {
          const tail = await (r as XReadRedis).xread("COUNT", 50, "STREAMS", stream, lastId);
          if (!tail) break;
          for (const [, entries] of tail) {
            for (const [entryId, fields] of entries) {
              lastId = entryId;
              const raw = fields[1];
              if (raw) yield raw;
            }
          }
          break;
        }
        continue;
      }

      for (const [, entries] of response) {
        for (const [entryId, fields] of entries) {
          lastId = entryId;
          const raw = fields[1];
          if (raw) yield raw;
          if (raw.includes("data: [DONE]")) return;
        }
      }
    }
  }

  async finishRun(conversationId: string, runId: string): Promise<void> {
    const r = getRedis();
    const active = activeKey(conversationId);
    const current = await r.hget(active, "run_id");
    if (current === runId) await r.del(active);
  }

  async requestCancel(conversationId: string): Promise<string | null> {
    await this.ensureConversation(conversationId);
    const r = getRedis();
    const active = activeKey(conversationId);
    const runId = await r.hget(active, "run_id");
    if (!runId) return null;
    await r.hset(active, { cancel_requested: "1" });
    return runId;
  }

  async isCancelRequested(conversationId: string, runId: string): Promise<boolean> {
    const r = getRedis();
    const active = activeKey(conversationId);
    const data = await r.hgetall(active);
    return data.run_id === runId && data.cancel_requested === "1";
  }

  async *streamEvents(conversationId: string, runId: string): AsyncGenerator<Record<string, unknown>> {
    const r = getRedis();
    const stream = streamKey(conversationId, runId);
    let lastId = "0-0";

    while (true) {
      const response = await (r as XReadRedis).xread(
        "BLOCK",
        STREAM_BLOCK_MS,
        "COUNT",
        50,
        "STREAMS",
        stream,
        lastId,
      );
      if (!response) {
        if (!(await this.isActive(conversationId, runId))) {
          const tail = await (r as XReadRedis).xread("COUNT", 50, "STREAMS", stream, lastId);
          if (!tail) break;
          for (const [, entries] of tail) {
            for (const [entryId, fields] of entries) {
              lastId = entryId;
              const raw = fields[1];
              if (!raw) continue;
              const event = JSON.parse(raw) as Record<string, unknown>;
              yield event;
              if (this.shouldStop(event)) return;
            }
          }
          break;
        }
        continue;
      }

      for (const [, entries] of response) {
        for (const [entryId, fields] of entries) {
          lastId = entryId;
          const raw = fields[1];
          if (!raw) continue;
          const event = JSON.parse(raw) as Record<string, unknown>;
          yield event;
          if (this.shouldStop(event)) return;
        }
      }
    }
  }

  private shouldStop(event: Record<string, unknown>): boolean {
    if (event.type === "error") return true;
    if (event.type === "done") return true;
    if (event.type === "message" && (event.status === "completed" || event.status === "failed" || event.status === "cancelled")) {
      return true;
    }
    return false;
  }

  private async isActive(conversationId: string, runId: string): Promise<boolean> {
    return (await this.liveRunId(conversationId)) === runId;
  }

  private async liveRunId(conversationId: string): Promise<string | null> {
    const r = getRedis();
    const active = activeKey(conversationId);
    const data = await r.hgetall(active);
    const runId = data.run_id;
    if (!runId) return null;
    return runId;
  }
}
