import { Redis } from "ioredis";

import { getSettings } from "../config.js";
import { getConversationRow } from "./conversations.js";
import type { AuthContext } from "../middleware/auth.js";

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
  constructor(
    private readonly auth: AuthContext,
    private readonly settings = getSettings(),
  ) {}

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
    await r.expire(active, this.settings.agentEventStreamTtlSeconds);
    await r.expire(stream, this.settings.agentEventStreamTtlSeconds);
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
      .expire(stream, this.settings.agentEventStreamTtlSeconds)
      .expire(active, this.settings.agentEventStreamTtlSeconds)
      .exec();
  }

  async finishRun(conversationId: string, runId: string): Promise<void> {
    const r = getRedis();
    const active = activeKey(conversationId);
    const current = await r.hget(active, "run_id");
    if (current === runId) await r.del(active);
  }

  async *streamEvents(conversationId: string, runId: string): AsyncGenerator<Record<string, unknown>> {
    const r = getRedis();
    const stream = streamKey(conversationId, runId);
    let lastId = "0-0";
    const settings = this.settings;

    while (true) {
      const response = await (r as XReadRedis).xread(
        "BLOCK",
        settings.agentEventStreamBlockMs,
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
    if (event.type === "message" && (event.status === "completed" || event.status === "failed")) {
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
    const stream = streamKey(conversationId, runId);
    const len = await r.xlen(stream);
    if (len > 0) return runId;
    const startedAt = Number(data.started_at_ms || 0);
    if (!startedAt || nowMs() - startedAt > this.settings.agentEventStreamStaleSeconds * 1000) {
      await r.del(active);
      return null;
    }
    return runId;
  }
}
