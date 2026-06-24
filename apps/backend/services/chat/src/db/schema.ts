import { datetime, index, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";

export const conversations = mysqlTable(
  "conversations",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    title: varchar("title", { length: 200 }).notNull().default("新对话"),
    model: varchar("model", { length: 120 }).notNull().default(""),
    providerId: varchar("provider_id", { length: 32 }).notNull().default(""),
    createdAt: datetime("created_at", { mode: "date", fsp: 6 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 6 }).notNull(),
  },
  (t) => [index("ix_conversations_user_id").on(t.userId)],
);

export const messages = mysqlTable(
  "messages",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    conversationId: varchar("conversation_id", { length: 32 }).notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    content: text("content").notNull(),
    status: varchar("status", { length: 20 }).notNull().default("ok"),
    createdAt: datetime("created_at", { mode: "date", fsp: 6 }).notNull(),
  },
  (t) => [index("ix_messages_conversation_id").on(t.conversationId)],
);
