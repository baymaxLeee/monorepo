import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

export interface PersistedMessageContent {
  version: number;
  parts: unknown[];
}

export const conversations = pgTable(
  "conversations",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    orgId: varchar("org_id", { length: 26 }).notNull(),
    title: varchar("title", { length: 200 }).notNull().default("新对话"),
    model: varchar("model", { length: 120 }).notNull().default(""),
    providerId: varchar("provider_id", { length: 32 }).notNull().default(""),
    activePlanPath: varchar("active_plan_path", { length: 512 }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [index("ix_conversations_user_id").on(t.userId), index("ix_conversations_user_org").on(t.userId, t.orgId)],
);

export const conversationArtifactCleanupOutbox = pgTable(
  "conversation_artifact_cleanup_outbox",
  {
    conversationId: varchar("conversation_id", { length: 32 }).primaryKey(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    orgId: varchar("org_id", { length: 26 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    claimedAt: timestamp("claimed_at", { mode: "date", withTimezone: true, precision: 6 }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [index("ix_conversation_artifact_cleanup_outbox_available").on(t.availableAt, t.createdAt)],
);

export const conversationContexts = pgTable("conversation_contexts", {
  conversationId: varchar("conversation_id", { length: 32 }).primaryKey(),
  revision: integer("revision").notNull().default(1),
  coveredThroughMessageId: varchar("covered_through_message_id", { length: 32 }),
  summary: text("summary").notNull(),
  stateJson: jsonb("state_json").$type<Record<string, unknown>>().notNull(),
  estimatedTokens: integer("estimated_tokens").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
});

export const conversationRunLeases = pgTable(
  "conversation_run_leases",
  {
    conversationId: varchar("conversation_id", { length: 32 }).primaryKey(),
    runId: varchar("run_id", { length: 32 }).notNull(),
    heartbeatAt: timestamp("heartbeat_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [uniqueIndex("ux_conversation_run_leases_run_id").on(t.runId)],
);

export const messages = pgTable(
  "messages",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    conversationId: varchar("conversation_id", { length: 32 }).notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    content: jsonb("content").$type<PersistedMessageContent>().notNull(),
    status: varchar("status", { length: 20 }).notNull().default("ok"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [index("ix_messages_conversation_id").on(t.conversationId)],
);

export const agentRuns = pgTable(
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
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    totalTokens: integer("total_tokens"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true, precision: 6 }),
  },
  (t) => [
    index("ix_agent_runs_conversation_id").on(t.conversationId),
    index("ix_agent_runs_user_id").on(t.userId),
  ],
);

export const agentSteps = pgTable(
  "agent_steps",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    runId: varchar("run_id", { length: 32 }).notNull(),
    stepIndex: integer("step_index").notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    summary: text("summary"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true, precision: 6 }),
  },
  (t) => [
    index("ix_agent_steps_run_id").on(t.runId),
    index("ix_agent_steps_run_step").on(t.runId, t.stepIndex),
  ],
);

export const agentToolCalls = pgTable(
  "agent_tool_calls",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    runId: varchar("run_id", { length: 32 }).notNull(),
    stepIndex: integer("step_index"),
    toolName: varchar("tool_name", { length: 80 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    inputJson: jsonb("input_json").$type<unknown>(),
    outputJson: jsonb("output_json").$type<unknown>(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true, precision: 6 }),
  },
  (t) => [
    index("ix_agent_tool_calls_run_id").on(t.runId),
    index("ix_agent_tool_calls_tool_name").on(t.toolName),
  ],
);

export const userMemories = pgTable(
  "user_memories",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    category: varchar("category", { length: 40 }).notNull(),
    content: text("content").notNull(),
    source: varchar("source", { length: 80 }).notNull().default("agent"),
    confidence: integer("confidence").notNull().default(80),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    reason: text("reason"),
    originRunId: varchar("origin_run_id", { length: 32 }),
    supersedesId: varchar("supersedes_id", { length: 32 }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    index("ix_user_memories_user_id").on(t.userId),
    index("ix_user_memories_user_status").on(t.userId, t.status),
  ],
);
