import { datetime, index, int, json, mysqlTable, text, varchar } from "drizzle-orm/mysql-core";

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

export const agentRuns = mysqlTable(
  "agent_runs",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    conversationId: varchar("conversation_id", { length: 32 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    providerId: varchar("provider_id", { length: 32 }).notNull().default(""),
    model: varchar("model", { length: 120 }).notNull().default(""),
    status: varchar("status", { length: 20 }).notNull(),
    error: text("error"),
    inputMessageId: varchar("input_message_id", { length: 32 }),
    outputMessageId: varchar("output_message_id", { length: 32 }),
    totalTokens: int("total_tokens"),
    createdAt: datetime("created_at", { mode: "date", fsp: 6 }).notNull(),
    startedAt: datetime("started_at", { mode: "date", fsp: 6 }).notNull(),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 6 }),
  },
  (t) => [
    index("ix_agent_runs_conversation_id").on(t.conversationId),
    index("ix_agent_runs_user_id").on(t.userId),
  ],
);

export const agentSteps = mysqlTable(
  "agent_steps",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    runId: varchar("run_id", { length: 32 }).notNull(),
    stepIndex: int("step_index").notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    summary: text("summary"),
    metadata: json("metadata").$type<Record<string, unknown> | null>(),
    createdAt: datetime("created_at", { mode: "date", fsp: 6 }).notNull(),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 6 }),
  },
  (t) => [
    index("ix_agent_steps_run_id").on(t.runId),
    index("ix_agent_steps_run_step").on(t.runId, t.stepIndex),
  ],
);

export const agentToolCalls = mysqlTable(
  "agent_tool_calls",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    runId: varchar("run_id", { length: 32 }).notNull(),
    stepIndex: int("step_index"),
    toolName: varchar("tool_name", { length: 80 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    inputJson: json("input_json").$type<unknown>(),
    outputJson: json("output_json").$type<unknown>(),
    error: text("error"),
    durationMs: int("duration_ms"),
    createdAt: datetime("created_at", { mode: "date", fsp: 6 }).notNull(),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 6 }),
  },
  (t) => [
    index("ix_agent_tool_calls_run_id").on(t.runId),
    index("ix_agent_tool_calls_tool_name").on(t.toolName),
  ],
);

export const userMemories = mysqlTable(
  "user_memories",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    category: varchar("category", { length: 40 }).notNull(),
    content: text("content").notNull(),
    source: varchar("source", { length: 80 }).notNull().default("agent"),
    confidence: int("confidence").notNull().default(80),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    reason: text("reason"),
    originRunId: varchar("origin_run_id", { length: 32 }),
    supersedesId: varchar("supersedes_id", { length: 32 }),
    createdAt: datetime("created_at", { mode: "date", fsp: 6 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 6 }).notNull(),
  },
  (t) => [
    index("ix_user_memories_user_id").on(t.userId),
    index("ix_user_memories_user_status").on(t.userId, t.status),
  ],
);
