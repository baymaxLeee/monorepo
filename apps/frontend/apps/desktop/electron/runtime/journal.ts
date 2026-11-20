import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { parseRuntimeCompactionState } from "@repo/agent-runtime/context/compaction";
import type { RuntimeContextCheckpoint, RuntimeContextCheckpointWrite } from "@repo/agent-runtime/context/manager";
import { toPersistedTurnPluginSnapshot } from "@repo/agent-runtime/plugins/snapshot";
import type { PersistedTurnPluginSnapshot, ResolvedTurnPluginSnapshot } from "@repo/agent-runtime/plugins/types";
import type { UIMessage } from "ai";

import type { LocalThread } from "../../contracts/bridge.generated";

const approvalPolicies = new Set(["never", "on-request", "unless-trusted", "granular"]);
const permissionProfiles = new Set([":read-only", ":workspace", ":danger-full-access"]);
const contextUsageCategoryIds = new Set(["system", "tools", "rules", "skills", "mcp", "memory", "conversation"]);

function parseContextUsage(value: unknown): LocalThread["contextUsage"] {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("本地上下文用量格式无效");
  const usage = value as Record<string, unknown>;
  if (
    typeof usage.contextWindow !== "number" ||
    !Number.isFinite(usage.contextWindow) ||
    usage.contextWindow <= 0 ||
    typeof usage.autoCompactAt !== "number" ||
    !Number.isFinite(usage.autoCompactAt) ||
    usage.autoCompactAt <= 0 ||
    typeof usage.usedTokens !== "number" ||
    !Number.isFinite(usage.usedTokens) ||
    usage.usedTokens < 0 ||
    typeof usage.estimated !== "boolean" ||
    typeof usage.compacted !== "boolean" ||
    !Array.isArray(usage.categories)
  ) {
    throw new Error("本地上下文用量格式无效");
  }
  for (const category of usage.categories) {
    if (
      !category ||
      typeof category !== "object" ||
      Array.isArray(category) ||
      typeof category.id !== "string" ||
      !contextUsageCategoryIds.has(category.id) ||
      typeof category.tokens !== "number" ||
      !Number.isFinite(category.tokens) ||
      category.tokens < 0
    ) {
      throw new Error("本地上下文分类用量格式无效");
    }
  }
  return value as LocalThread["contextUsage"];
}

function parseThreadMetadata(value: string): Omit<LocalThread, "messages"> {
  const metadata: unknown = JSON.parse(value);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("本地会话元数据格式无效");
  }
  const record = metadata as Record<string, unknown>;
  if ("approvalMode" in record) {
    throw new Error("本地会话使用已移除的 approvalMode，无法打开");
  }
  if (typeof record.approvalPolicy !== "string" || !approvalPolicies.has(record.approvalPolicy)) {
    throw new Error("本地会话缺少有效的 approvalPolicy");
  }
  if (typeof record.permissionProfile !== "string" || !permissionProfiles.has(record.permissionProfile)) {
    throw new Error("本地会话缺少有效的 permissionProfile");
  }
  return { ...record, contextUsage: parseContextUsage(record.contextUsage) } as Omit<LocalThread, "messages">;
}

/** SQLite rollout store for the local host. Previous Desktop database filenames are intentionally not imported. */
export class LocalJournal {
  private readonly db: DatabaseSync;

  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    this.db = new DatabaseSync(join(directory, "runtime.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    const version = Number(this.db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version !== 0 && version !== 1) {
      this.db.close();
      throw new Error("本地 runtime 数据由更新版本创建，请升级桌面应用");
    }
    if (version === 0) {
      this.db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE threads (
          id TEXT PRIMARY KEY,
          metadata TEXT NOT NULL
        );
        CREATE TABLE turns (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          finished_at TEXT,
          error TEXT
        );
        CREATE INDEX turns_thread_created ON turns(thread_id, created_at);
        CREATE TABLE items (
          thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
          id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          turn_id TEXT REFERENCES turns(id),
          value TEXT NOT NULL,
          PRIMARY KEY(thread_id, id),
          UNIQUE(thread_id, sequence)
        );
        CREATE TABLE context_checkpoints (
          thread_id TEXT PRIMARY KEY REFERENCES threads(id) ON DELETE CASCADE,
          revision INTEGER NOT NULL,
          covered_item_id TEXT NOT NULL,
          state TEXT NOT NULL,
          estimated_tokens INTEGER NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE turn_plugin_snapshots (
          turn_id TEXT PRIMARY KEY REFERENCES turns(id) ON DELETE CASCADE,
          snapshot_id TEXT NOT NULL,
          snapshot_digest TEXT NOT NULL CHECK(length(snapshot_digest) = 71 AND snapshot_digest GLOB 'sha256:*'),
          value TEXT NOT NULL CHECK(json_valid(value)),
          created_at TEXT NOT NULL
        );
        PRAGMA user_version=1;
        COMMIT;`);
    }
  }

  list(): LocalThread[] {
    return this.db
      .prepare("SELECT metadata FROM threads ORDER BY json_extract(metadata,'$.updatedAt') DESC")
      .all()
      .map((row) => parseThreadMetadata(String(row.metadata)))
      .map((thread) => ({ ...thread, messages: [] }));
  }

  get(id: string): LocalThread {
    const row = this.db.prepare("SELECT metadata FROM threads WHERE id=?").get(id);
    if (!row) throw new Error("本地会话不存在");
    const metadata = parseThreadMetadata(String(row.metadata));
    const messages = this.db
      .prepare("SELECT value FROM items WHERE thread_id=? ORDER BY sequence")
      .all(id)
      .map((item) => JSON.parse(String(item.value)) as UIMessage);
    return { ...metadata, messages };
  }

  save(thread: LocalThread): void {
    const { messages, ...metadata } = thread;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO threads(id,metadata) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata",
        )
        .run(thread.id, JSON.stringify(metadata));
      if (thread.turnId) {
        const terminal = !["running", "waiting"].includes(thread.status);
        this.db
          .prepare(
            `INSERT INTO turns(id,thread_id,status,created_at,finished_at,error)
             VALUES(?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET status=excluded.status, finished_at=excluded.finished_at, error=excluded.error`,
          )
          .run(
            thread.turnId,
            thread.id,
            thread.status,
            thread.updatedAt,
            terminal ? thread.updatedAt : null,
            thread.error,
          );
      }
      const existing = this.db
        .prepare("SELECT id, sequence FROM items WHERE thread_id=? ORDER BY sequence")
        .all(thread.id);
      for (const [index, row] of existing.entries()) {
        if (Number(row.sequence) !== index || messages[index]?.id !== String(row.id)) {
          throw new Error("local rollout history is not append-only");
        }
      }
      const insert = this.db.prepare(
        `INSERT INTO items(thread_id,id,sequence,turn_id,value) VALUES(?,?,?,?,?)
         ON CONFLICT(thread_id,id) DO UPDATE SET value=excluded.value`,
      );
      for (const [index, message] of messages.entries()) {
        insert.run(thread.id, message.id, index, thread.turnId, JSON.stringify(message));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getCheckpoint(threadId: string): RuntimeContextCheckpoint | null {
    const row = this.db
      .prepare("SELECT revision, covered_item_id, state FROM context_checkpoints WHERE thread_id=?")
      .get(threadId);
    if (!row) return null;
    const state = parseRuntimeCompactionState(JSON.parse(String(row.state)));
    if (!state) return null;
    return {
      revision: Number(row.revision),
      coveredThroughMessageId: String(row.covered_item_id),
      state,
    };
  }

  saveCheckpoint(threadId: string, checkpoint: RuntimeContextCheckpointWrite): void {
    const now = new Date().toISOString();
    if (checkpoint.expectedRevision == null) {
      this.db
        .prepare(
          `INSERT INTO context_checkpoints(thread_id,revision,covered_item_id,state,estimated_tokens,updated_at)
           VALUES(?,1,?,?,?,?)`,
        )
        .run(
          threadId,
          checkpoint.coveredThroughMessageId,
          JSON.stringify(checkpoint.state),
          checkpoint.estimatedTokens,
          now,
        );
      return;
    }
    const result = this.db
      .prepare(
        `UPDATE context_checkpoints
         SET revision=?, covered_item_id=?, state=?, estimated_tokens=?, updated_at=?
         WHERE thread_id=? AND revision=?`,
      )
      .run(
        checkpoint.expectedRevision + 1,
        checkpoint.coveredThroughMessageId,
        JSON.stringify(checkpoint.state),
        checkpoint.estimatedTokens,
        now,
        threadId,
        checkpoint.expectedRevision,
      );
    if (result.changes !== 1) throw new Error("local context checkpoint revision conflict");
  }

  savePluginSnapshot(turnId: string, snapshot: ResolvedTurnPluginSnapshot): void {
    const persisted = toPersistedTurnPluginSnapshot(snapshot);
    const value = JSON.stringify(persisted);
    const existing = this.db.prepare("SELECT value FROM turn_plugin_snapshots WHERE turn_id=?").get(turnId);
    if (existing) {
      if (String(existing.value) !== value) throw new Error("local turn plugin snapshot is immutable");
      return;
    }
    this.db
      .prepare(
        `INSERT INTO turn_plugin_snapshots(turn_id,snapshot_id,snapshot_digest,value,created_at)
         VALUES(?,?,?,?,?)`,
      )
      .run(turnId, persisted.snapshotId, persisted.snapshotDigest, value, new Date().toISOString());
  }

  getPluginSnapshot(turnId: string): PersistedTurnPluginSnapshot | null {
    const row = this.db.prepare("SELECT value FROM turn_plugin_snapshots WHERE turn_id=?").get(turnId);
    return row ? (JSON.parse(String(row.value)) as PersistedTurnPluginSnapshot) : null;
  }

  remove(id: string): void {
    this.db.prepare("DELETE FROM threads WHERE id=?").run(id);
  }

  close(): void {
    this.db.close();
  }
}
