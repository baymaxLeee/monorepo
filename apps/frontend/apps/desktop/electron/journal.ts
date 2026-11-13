import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { UIMessage } from "ai";

import type { LocalThread } from "../contracts/bridge.generated";

export class LocalJournal {
  private db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, "sessions.sqlite"));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
    const version = this.db.prepare("PRAGMA user_version").get()?.user_version;
    if (version !== 0 && version !== 1) {
      this.db.close();
      throw new Error("本地会话由更新版本创建，请升级桌面应用");
    }
    if (version === 0)
      this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE threads (id TEXT PRIMARY KEY, metadata TEXT NOT NULL);
      CREATE TABLE messages (thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE, id TEXT NOT NULL, position INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(thread_id,id), UNIQUE(thread_id,position));
      PRAGMA user_version=1; COMMIT;`);
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
    return { ...JSON.parse(String(row.metadata)), messages };
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
