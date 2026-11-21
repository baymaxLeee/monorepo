import type { PersistedTurnPluginSnapshot } from "@repo/agent-runtime";
import { sql } from "drizzle-orm";
import {
  bigint,
  foreignKey,
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

export interface PersistedThreadItemContent {
  version: number;
  parts: unknown[];
  metadata?: Record<string, unknown>;
}

/** Canonical conversation metadata. Mutable execution state belongs to Turns. */
export const threads = pgTable(
  "threads",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    workspaceId: varchar("workspace_id", { length: 26 }).notNull(),
    model: varchar("model", { length: 120 }).notNull().default(""),
    providerId: varchar("provider_id", { length: 32 }).notNull().default(""),
    reasoningEffort: varchar("reasoning_effort", { length: 16 }).notNull().default("medium"),
    approvalPolicy: varchar("approval_policy", { length: 24 }).notNull().default("on-request"),
    permissionProfile: varchar("permission_profile", { length: 32 }).notNull().default(":workspace"),
    executionMode: varchar("execution_mode", { length: 20 }).notNull().default("cloud"),
    turnSequence: bigint("turn_sequence", { mode: "bigint" }).notNull().default(0n),
    itemSequence: bigint("item_sequence", { mode: "bigint" }).notNull().default(0n),
    historyRevision: bigint("history_revision", { mode: "bigint" }).notNull().default(0n),
    selectedItemId: varchar("selected_item_id", { length: 32 }),
    createRequestId: varchar("create_request_id", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    index("ix_threads_user_id").on(t.userId),
    index("ix_threads_scope_updated").on(t.tenantId, t.workspaceId, t.userId, t.updatedAt),
    uniqueIndex("ux_threads_create_request").on(t.tenantId, t.workspaceId, t.userId, t.createRequestId),
  ],
);

/** A single admitted RuntimeTurn and its terminal outcome. */
export const turns = pgTable(
  "turns",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    threadId: varchar("thread_id", { length: 32 })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    ordinal: bigint("ordinal", { mode: "bigint" }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    providerId: varchar("provider_id", { length: 32 }).notNull().default(""),
    model: varchar("model", { length: 120 }).notNull().default(""),
    status: varchar("status", { length: 20 }).notNull(),
    error: text("error"),
    inputItemId: varchar("input_item_id", { length: 32 }),
    outputItemId: varchar("output_item_id", { length: 32 }),
    requestId: varchar("request_id", { length: 64 }),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }),
    operation: varchar("operation", { length: 32 }),
    targetItemId: varchar("target_item_id", { length: 32 }),
    historyItemId: varchar("history_item_id", { length: 32 }),
    historyRevision: bigint("history_revision", { mode: "bigint" }),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull().default(1n),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cachedInputTokens: integer("cached_input_tokens"),
    reasoningTokens: integer("reasoning_tokens"),
    totalTokens: integer("total_tokens"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true, precision: 6 }),
  },
  (t) => [
    uniqueIndex("ux_turns_thread_ordinal").on(t.threadId, t.ordinal),
    uniqueIndex("ux_turns_thread_request").on(t.threadId, t.requestId),
    uniqueIndex("ux_turns_one_active")
      .on(t.threadId)
      .where(sql`${t.status} IN ('running', 'cancel_requested')`),
    index("ix_turns_thread_created").on(t.threadId, t.createdAt),
    index("ix_turns_user_id").on(t.userId),
    index("ix_turns_history_item_id").on(t.historyItemId),
  ],
);

/** Immutable, non-secret plugin resolution used by one Turn. Connection grants never enter this table. */
export const turnPluginSnapshots = pgTable("turn_plugin_snapshots", {
  turnId: varchar("turn_id", { length: 32 })
    .primaryKey()
    .references(() => turns.id, { onDelete: "cascade" }),
  snapshot: jsonb("snapshot_json").$type<PersistedTurnPluginSnapshot>().notNull(),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
});

/** Durable UIMessage journal projection with stable, append-only ordering. */
export const threadItems = pgTable(
  "thread_items",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    threadId: varchar("thread_id", { length: 32 })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    turnId: varchar("turn_id", { length: 32 }).references(() => turns.id, { onDelete: "set null" }),
    ordinal: bigint("ordinal", { mode: "bigint" }).notNull(),
    role: varchar("role", { length: 20 }).notNull(),
    content: jsonb("content").$type<PersistedThreadItemContent>().notNull(),
    status: varchar("status", { length: 20 }).notNull().default("ok"),
    parentItemId: varchar("parent_item_id", { length: 32 }),
    branchIndex: integer("branch_index").notNull().default(0),
    revision: bigint("revision", { mode: "bigint" }).notNull().default(1n),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    uniqueIndex("ux_thread_items_ordinal").on(t.threadId, t.ordinal),
    uniqueIndex("ux_thread_items_sibling_branch").on(t.threadId, t.parentItemId, t.branchIndex),
    index("ix_thread_items_parent").on(t.parentItemId),
    index("ix_thread_items_turn_ordinal").on(t.turnId, t.ordinal),
  ],
);

/** Synchronous input admission and delivery state for a live Turn. */
export const turnInputs = pgTable(
  "turn_inputs",
  {
    turnId: varchar("turn_id", { length: 32 })
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    id: varchar("id", { length: 64 }).notNull(),
    threadId: varchar("thread_id", { length: 32 })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    mode: varchar("mode", { length: 20 }).notNull(),
    text: text("text").notNull(),
    state: varchar("state", { length: 20 }).notNull(),
    stepNumber: integer("step_number"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.turnId, t.id] }),
    index("ix_turn_inputs_pending").on(t.turnId, t.state, t.createdAt),
  ],
);

/** Revision-fenced rolling summary derived from the item journal. */
export const contextCheckpoints = pgTable("context_checkpoints", {
  threadId: varchar("thread_id", { length: 32 })
    .primaryKey()
    .references(() => threads.id, { onDelete: "cascade" }),
  revision: bigint("revision", { mode: "bigint" }).notNull().default(1n),
  coveredItemId: varchar("covered_item_id", { length: 32 }).notNull(),
  summary: text("summary").notNull(),
  stateJson: jsonb("state_json").$type<Record<string, unknown>>().notNull(),
  estimatedTokens: integer("estimated_tokens").notNull().default(0),
  createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
});

/** Active writer claim. The thread primary key is the database-enforced one-active-Turn gate. */
export const turnLeases = pgTable(
  "turn_leases",
  {
    threadId: varchar("thread_id", { length: 32 })
      .primaryKey()
      .references(() => threads.id, { onDelete: "cascade" }),
    turnId: varchar("turn_id", { length: 32 })
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull(),
    heartbeatAt: timestamp("heartbeat_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [uniqueIndex("ux_turn_leases_turn_id").on(t.turnId)],
);

/** Model/tool trace projection. It is observable state, not the journal authority. */
export const turnSteps = pgTable(
  "turn_steps",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    turnId: varchar("turn_id", { length: 32 })
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    stepIndex: integer("step_index").notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    summary: text("summary"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true, precision: 6 }),
  },
  (t) => [
    index("ix_turn_steps_turn_id").on(t.turnId),
    uniqueIndex("ux_turn_steps_turn_step").on(t.turnId, t.stepIndex),
  ],
);

export const toolExecutions = pgTable(
  "tool_executions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    turnId: varchar("turn_id", { length: 32 })
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    itemId: varchar("item_id", { length: 32 }).references(() => threadItems.id, { onDelete: "set null" }),
    stepIndex: integer("step_index"),
    toolName: varchar("tool_name", { length: 80 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    inputJson: jsonb("input_json").$type<unknown>(),
    outputJson: jsonb("output_json").$type<unknown>(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true, precision: 6 }),
  },
  (t) => [index("ix_tool_executions_turn_id").on(t.turnId), index("ix_tool_executions_tool_name").on(t.toolName)],
);

export const turnSandboxExecutions = pgTable(
  "turn_sandbox_executions",
  {
    turnId: varchar("turn_id", { length: 32 })
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull(),
    threadId: varchar("thread_id", { length: 32 })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
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
  (t) => [
    primaryKey({ columns: [t.turnId, t.attemptEpoch] }),
    index("ix_turn_sandbox_executions_releasing").on(t.state, t.updatedAt),
  ],
);

export const sandboxWorkspaceCheckout = pgTable(
  "sandbox_workspace_checkout",
  {
    turnId: varchar("turn_id", { length: 32 }).notNull(),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull(),
    workspacePath: text("workspace_path").notNull(),
    fileId: varchar("file_id", { length: 32 }).notNull(),
    pathGeneration: bigint("path_generation", { mode: "number" }).notNull(),
    etag: text("etag").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.turnId, t.attemptEpoch, t.workspacePath] }),
    foreignKey({
      columns: [t.turnId, t.attemptEpoch],
      foreignColumns: [turnSandboxExecutions.turnId, turnSandboxExecutions.attemptEpoch],
    }).onDelete("cascade"),
  ],
);

export const threadFiles = pgTable(
  "thread_files",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    threadId: varchar("thread_id", { length: 32 })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
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
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    contentGeneration: bigint("content_generation", { mode: "bigint" }).notNull().default(1n),
    contentEtag: varchar("content_etag", { length: 32 }).notNull(),
    lastWriterType: varchar("last_writer_type", { length: 20 }).notNull(),
    lastWriterId: varchar("last_writer_id", { length: 128 }),
  },
  (t) => [
    index("ix_thread_files_thread").on(t.threadId, t.createdAt),
    index("ix_thread_files_asset_revision").on(t.assetId, t.revisionId),
    uniqueIndex("ux_thread_files_idempotency").on(t.tenantId, t.workspaceId, t.userId, t.threadId, t.idempotencyKey),
    uniqueIndex("ux_thread_files_live_workspace_path")
      .on(t.tenantId, t.workspaceId, t.threadId, t.workspacePath)
      .where(sql`${t.workspaceState} = 'live'`),
  ],
);

export const threadFileSaveOperations = pgTable(
  "thread_file_save_operations",
  {
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    workspaceId: varchar("workspace_id", { length: 26 }).notNull(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    threadId: varchar("thread_id", { length: 32 })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    operationId: varchar("operation_id", { length: 80 }).notNull(),
    fileId: varchar("file_id", { length: 32 })
      .notNull()
      .references(() => threadFiles.id, { onDelete: "cascade" }),
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
    primaryKey({ columns: [t.tenantId, t.workspaceId, t.userId, t.threadId, t.operationId] }),
    index("ix_thread_file_save_operations_file").on(t.fileId, t.createdAt),
    index("ix_thread_file_save_operations_pending")
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

export const threadArtifactCleanupOutbox = pgTable(
  "thread_artifact_cleanup_outbox",
  {
    threadId: varchar("thread_id", { length: 32 }).primaryKey(),
    userId: varchar("user_id", { length: 26 }).notNull(),
    tenantId: varchar("tenant_id", { length: 26 }).notNull(),
    workspaceId: varchar("workspace_id", { length: 26 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    claimedAt: timestamp("claimed_at", { mode: "date", withTimezone: true, precision: 6 }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [index("ix_thread_artifact_cleanup_outbox_available").on(t.availableAt, t.createdAt)],
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
    originTurnId: varchar("origin_turn_id", { length: 32 }),
    supersedesId: varchar("supersedes_id", { length: 32 }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [index("ix_user_memories_user_id").on(t.userId), index("ix_user_memories_user_status").on(t.userId, t.status)],
);
