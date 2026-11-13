import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { UIMessage } from "ai";

import type { LocalThread } from "../contracts/bridge.generated";

export class LocalJournal {
  private db: DatabaseSync;
  constructor(directory: string, legacyDirectories: string[] = []) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);
    const databasePath = join(directory, "sessions.sqlite");
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 0 && version !== 1 && version !== 2) {
      this.db.close();
      throw new Error("本地会话由更新版本创建，请升级桌面应用");
    }
    if (version === 0)
      this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE threads (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
      CREATE TABLE messages (thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(thread_id,id), UNIQUE(thread_id,position));
      CREATE TABLE legacy_imports (source TEXT PRIMARY KEY, imported_at TEXT NOT NULL);
      PRAGMA user_version=2; COMMIT;`);
    else if (version === 1)
      this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE legacy_imports (source TEXT PRIMARY KEY, imported_at TEXT NOT NULL);
      PRAGMA user_version=2; COMMIT;`);
    for (const legacyDirectory of legacyDirectories) this.importLegacy(databasePath, legacyDirectory);
  }
  private importLegacy(databasePath: string, legacyDirectory: string) {
    const source = resolve(legacyDirectory, "sessions.sqlite");
    if (source === resolve(databasePath) || !existsSync(source)) return;
    if (this.db.prepare("SELECT 1 FROM legacy_imports WHERE source=?").get(source)) return;
    const legacy = new DatabaseSync(source, { readOnly: true });
    try {
      const version = legacy.prepare("PRAGMA user_version").get()?.user_version;
      if (version !== 1 && version !== 2) throw new Error(`无法迁移旧本地会话数据库：${source}`);
      const threads = legacy.prepare("SELECT id, metadata FROM threads").all();
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of threads) {
          const id = String(row.id);
          const metadata = String(row.metadata);
          const incoming = JSON.parse(metadata) as { updatedAt?: string };
          const currentRow = this.db.prepare("SELECT metadata FROM threads WHERE id=?").get(id);
          if (currentRow) {
            const current = JSON.parse(String(currentRow.metadata)) as { updatedAt?: string };
            if (timestamp(current.updatedAt) >= timestamp(incoming.updatedAt)) continue;
            this.db.prepare("DELETE FROM messages WHERE thread_id=?").run(id);
          }
          this.db
            .prepare(
              "INSERT INTO threads(id,metadata) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata",
            )
            .run(id, metadata);
          const messages = legacy
            .prepare("SELECT id, position, value FROM messages WHERE thread_id=? ORDER BY position")
            .all(id);
          const insert = this.db.prepare("INSERT INTO messages(thread_id,id,position,value) VALUES(?,?,?,?)");
          for (const message of messages)
            insert.run(id, String(message.id), Number(message.position), String(message.value));
        }
        this.db
          .prepare("INSERT INTO legacy_imports(source,imported_at) VALUES(?,?)")
          .run(source, new Date().toISOString());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } finally {
      legacy.close();
    }
  }
  list(): LocalThread[] {
    return this.db
      .prepare("SELECT metadata FROM threads ORDER BY json_extract(metadata,'$.updatedAt') DESC")
      .all()
      .map((row) => ({ ...JSON.parse(String(row.metadata)), messages: [] }) as LocalThread);
  }
  get(id: string): LocalThread {
    const row = this.db.prepare("SELECT metadata FROM threads WHERE id=?").get(id);
    if (!row) throw new Error("本地会话不存在");
    const messages = this.db
      .prepare("SELECT value FROM messages WHERE thread_id=? ORDER BY position")
      .all(id)
      .map((item) => JSON.parse(String(item.value)) as UIMessage);
    const metadata = JSON.parse(String(row.metadata)) as Omit<LocalThread, "messages">;
    return { ...metadata, pendingInputs: metadata.pendingInputs ?? [], messages };
  }
  save(thread: LocalThread) {
    const { messages, ...metadata } = thread;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO threads(id,metadata) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata",
        )
        .run(thread.id, JSON.stringify(metadata));
      const save = this.db.prepare(
        "INSERT INTO messages(thread_id,id,position,value) VALUES(?,?,?,?) ON CONFLICT(thread_id,id) DO UPDATE SET value=excluded.value WHERE messages.value != excluded.value",
      );
      for (const [index, message] of messages.entries())
        save.run(thread.id, message.id, index, JSON.stringify(message));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  remove(id: string) {
    this.db.prepare("DELETE FROM threads WHERE id=?").run(id);
  }
  close() {
    this.db.close();
  }
}

function timestamp(value: string | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? 0 : parsed;
}
