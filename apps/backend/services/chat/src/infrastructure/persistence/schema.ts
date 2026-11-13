import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export interface PersistedMessageContent {
  version: number;
  parts: unknown[];
  metadata?: Record<string, unknown>;
}

export const conversations = pgTable(
  "conversations",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    workspaceId: varchar("workspace_id", { length: 26 }).notNull(),
    title: varchar("title", { length: 200 }).notNull().default("新对话"),
    model: varchar("model", { length: 120 }).notNull().default(""),
    providerId: varchar("provider_id", { length: 32 }).notNull().default(""),
    projectId: varchar("project_id", { length: 36 }),
    canvasId: varchar("canvas_id", { length: 36 }),
    activePlanFileId: varchar("active_plan_file_id", { length: 32 }),
    executionMode: varchar("execution_mode", { length: 20 }).notNull().default("cloud"),
    runRevision: bigint("run_revision", { mode: "bigint" }).notNull().default(0n),
    historyRevision: bigint("history_revision", { mode: "bigint" }).notNull().default(0n),
    selectedMessageId: varchar("selected_message_id", { length: 32 }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    index("ix_conversations_user_id").on(t.userId),
    index("ix_conversations_user_workspace").on(t.userId, t.tenantId, t.workspaceId),
    uniqueIndex("ux_conversations_canvas_owner").on(t.tenantId, t.workspaceId, t.userId, t.projectId, t.canvasId),
  ],
);

export const conversationFiles = pgTable(
  "conversation_files",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    conversationId: varchar("conversation_id", { length: 32 })
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: varchar("user_id", { length: 26 }).notNull(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    workspaceId: varchar("workspace_id", { length: 26 }).notNull(),
    assetId: uuid("asset_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    workspacePath: varchar("workspace_path", { length: 1024 }).notNull(),
    workspaceState: varchar("workspace_state", { length: 20 }).notNull().default("live"),
    pathGeneration: bigint("path_generation", { mode: "bigint" }).notNull().default(1n),
    mediaType: varchar("media_type", { length: 255 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    kind: varchar("kind", { length: 20 }).notNull().default("artifact"),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    contentGeneration: bigint("content_generation", { mode: "bigint" }).notNull().default(1n),
    contentEtag: varchar("content_etag", { length: 32 }).notNull(),
    lastWriterType: varchar("last_writer_type", { length: 20 }).notNull(),
    lastWriterId: varchar("last_writer_id", { length: 128 }),
  },
  (t) => [
    index("ix_conversation_files_conversation").on(t.conversationId, t.createdAt),
    index("ix_conversation_files_asset_revision").on(t.assetId, t.revisionId),
    uniqueIndex("ux_conversation_files_idempotency").on(
      t.tenantId,
      t.workspaceId,
      t.userId,
      t.conversationId,
      t.idempotencyKey,
    ),
    uniqueIndex("ux_conversation_files_live_workspace_path")
      .on(t.tenantId, t.workspaceId, t.conversationId, t.workspacePath)
      .where(sql`${t.workspaceState} = 'live'`),
  ],
);

export const conversationFileSaveOperations = pgTable(
  "conversation_file_save_operations",
  {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    workspaceId: varchar("workspace_id", { length: 26 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    conversationId: varchar("conversation_id", { length: 32 })
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    operationId: varchar("operation_id", { length: 80 }).notNull(),
    fileId: varchar("file_id", { length: 32 })
      .notNull()
      .references(() => conversationFiles.id, { onDelete: "cascade" }),
    expectedEtag: varchar("expected_etag", { length: 34 }).notNull(),
    contentSha256: varchar("content_sha256", { length: 64 }).notNull(),
    operationType: varchar("operation_type", { length: 20 }).notNull(),
    workspacePath: varchar("workspace_path", { length: 1024 }),
    expectedPathGeneration: bigint("expected_path_generation", { mode: "bigint" }),
    writerType: varchar("writer_type", { length: 20 }).notNull(),
    writerId: varchar("writer_id", { length: 128 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    leaseUntil: timestamp("lease_until", { mode: "date", withTimezone: true, precision: 6 }),
    resultJson: jsonb("result_json").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.workspaceId, t.userId, t.conversationId, t.operationId] }),
    index("ix_conversation_file_save_operations_file").on(t.fileId, t.createdAt),
    index("ix_conversation_file_save_operations_pending")
      .on(t.status, t.leaseUntil)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const assetClaimIntents = pgTable(
  "asset_claim_intents",
  {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    workspaceId: varchar("workspace_id", { length: 26 }).notNull(),
    ownerType: varchar("owner_type", { length: 64 }).notNull(),
    ownerId: varchar("owner_id", { length: 128 }).notNull(),
    slot: varchar("slot", { length: 128 }).notNull(),
    assetId: uuid("asset_id").notNull(),
    revisionId: uuid("revision_id"),
    kind: varchar("kind", { length: 20 }).notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(),
    desiredState: varchar("desired_state", { length: 20 }).notNull(),
    deliveredAt: timestamp("delivered_at", { mode: "date", withTimezone: true, precision: 6 }),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    leaseUntil: timestamp("lease_until", { mode: "date", withTimezone: true, precision: 6 }),
    stateVersion: bigint("state_version", { mode: "bigint" }).notNull().default(1n),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.workspaceId, t.ownerType, t.ownerId, t.slot] }),
    index("ix_asset_claim_intents_due").on(t.deliveredAt, t.nextAttemptAt, t.leaseUntil),
  ],
);

export const conversationArtifactCleanupOutbox = pgTable(
  "conversation_artifact_cleanup_outbox",
  {
    conversationId: varchar("conversation_id", { length: 32 }).primaryKey(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    workspaceId: varchar("workspace_id", { length: 26 }).notNull(),
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
    parentMessageId: varchar("parent_message_id", { length: 32 }),
    branchIndex: integer("branch_index").notNull().default(0),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    index("ix_messages_conversation_id").on(t.conversationId),
    index("ix_messages_parent_message_id").on(t.parentMessageId),
    uniqueIndex("ux_messages_sibling_branch").on(t.conversationId, t.parentMessageId, t.branchIndex),
  ],
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
    requestId: varchar("request_id", { length: 64 }),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }),
    operation: varchar("operation", { length: 32 }),
    targetMessageId: varchar("target_message_id", { length: 32 }),
    historyMessageId: varchar("history_message_id", { length: 32 }),
    historyRevision: bigint("history_revision", { mode: "bigint" }),
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
    index("ix_agent_runs_history_message_id").on(t.historyMessageId),
    uniqueIndex("ux_agent_runs_conversation_request").on(t.conversationId, t.requestId),
  ],
);

export const agentSteeringInputs = pgTable(
  "agent_steering_inputs",
  {
    runId: varchar("run_id", { length: 32 })
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    clientMessageId: varchar("client_message_id", { length: 64 }).notNull(),
    conversationId: varchar("conversation_id", { length: 32 }).notNull(),
    delivery: varchar("delivery", { length: 20 }).notNull(),
    text: text("text").notNull(),
    state: varchar("state", { length: 20 }).notNull(),
    stepNumber: integer("step_number"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.runId, t.clientMessageId] }),
    index("ix_agent_steering_inputs_pending").on(t.runId, t.state, t.createdAt),
  ],
);

export const sandboxExecutions = pgTable(
  "sandbox_executions",
  {
    runId: varchar("run_id", { length: 32 })
      .primaryKey()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    conversationId: varchar("conversation_id", { length: 32 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    workspaceId: varchar("workspace_id", { length: 26 }).notNull(),
    state: varchar("state", { length: 20 }).notNull(),
    sandboxId: varchar("sandbox_id", { length: 128 }),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true, precision: 6 }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [index("ix_sandbox_executions_releasing").on(t.state, t.updatedAt)],
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
  (t) => [index("ix_agent_steps_run_id").on(t.runId), index("ix_agent_steps_run_step").on(t.runId, t.stepIndex)],
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
  (t) => [index("ix_agent_tool_calls_run_id").on(t.runId), index("ix_agent_tool_calls_tool_name").on(t.toolName)],
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
  (t) => [index("ix_user_memories_user_id").on(t.userId), index("ix_user_memories_user_status").on(t.userId, t.status)],
);
