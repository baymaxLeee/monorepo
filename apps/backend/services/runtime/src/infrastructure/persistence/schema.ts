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

export interface PersistedTurnResumeSnapshot {
  schemaVersion: 2;
  execution: {
    operation: "submit-message" | "edit-message" | "regenerate-message" | "tool-continuation";
    assistantMessageId: string;
    reasoningEffort: string;
    approvalPolicy: string;
    permissionProfile: string;
    pluginActivations: Array<{ pluginId: string; bindings?: Record<string, string> }>;
    skills: Array<{ id: string; name: string; description: string }>;
    generateTitle: boolean;
    activeSkillName: string | null;
    clientCapabilities?: { uiAgent?: "ui-sdk" };
    instructions: string | null;
    providerBinding: {
      id: string;
      model: string;
      baseUrl: string;
      extraBody: Record<string, unknown>;
      contextWindow: number;
      maxOutputTokens: number;
      supportsImageInput: boolean;
      providerKind?: string;
    };
  };
}

export interface PersistedWorkspaceFinalizationSummary {
  manifestSha256: string;
  files: number;
  bytes: number;
  created: number;
  updated: number;
  deleted: number;
}

/** Canonical conversation metadata. Mutable execution state belongs to Turns. */
export const threads = pgTable(
  "threads",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    model: varchar("model", { length: 120 }).notNull().default(""),
    providerId: varchar("provider_id", { length: 32 }).notNull().default(""),
    reasoningEffort: varchar("reasoning_effort", { length: 16 }).notNull().default("medium"),
    approvalPolicy: varchar("approval_policy", { length: 24 }).notNull().default("on-request"),
    permissionProfile: varchar("permission_profile", { length: 32 }).notNull().default(":workspace"),
    executionMode: varchar("execution_mode", { length: 20 }).notNull().default("cloud"),
    turnSequence: bigint("turn_sequence", { mode: "bigint" }).notNull().default(0n),
    itemSequence: bigint("item_sequence", { mode: "bigint" }).notNull().default(0n),
    historyRevision: bigint("history_revision", { mode: "bigint" }).notNull().default(0n),
    sandboxGeneration: bigint("sandbox_generation", { mode: "bigint" }).notNull().default(0n),
    selectedItemId: varchar("selected_item_id", { length: 32 }),
    createRequestId: varchar("create_request_id", { length: 64 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [uniqueIndex("ux_threads_create_request").on(t.createRequestId), index("ix_threads_updated").on(t.updatedAt)],
);

/** A single admitted RuntimeTurn and its terminal outcome. */
export const threadTurns = pgTable(
  "thread_turns",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    threadId: varchar("thread_id", { length: 32 })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    ordinal: bigint("ordinal", { mode: "bigint" }).notNull(),
    providerId: varchar("provider_id", { length: 32 }).notNull().default(""),
    model: varchar("model", { length: 120 }).notNull().default(""),
    status: varchar("status", { length: 20 }).notNull(),
    error: text("error"),
    inputItemId: varchar("input_item_id", { length: 32 }),
    outputItemId: varchar("output_item_id", { length: 32 }),
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
    uniqueIndex("ux_thread_turns_thread_ordinal").on(t.threadId, t.ordinal),
    uniqueIndex("ux_thread_turns_one_active")
      .on(t.threadId)
      .where(sql`${t.status} IN ('running', 'cancel_requested', 'waiting')`),
    index("ix_thread_turns_thread_created").on(t.threadId, t.createdAt),
  ],
);

/** Immutable, non-secret plugin resolution used by one Turn. Connection grants never enter this table. */
export const turnPluginSnapshots = pgTable("turn_plugin_snapshots", {
  turnId: varchar("turn_id", { length: 32 })
    .primaryKey()
    .references(() => threadTurns.id, { onDelete: "cascade" }),
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
    turnId: varchar("turn_id", { length: 32 }).references(() => threadTurns.id, { onDelete: "set null" }),
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

/** One physical invocation of a logical Turn. Retries, recovery and client continuations get a new epoch. */
export const turnAttempts = pgTable(
  "turn_attempts",
  {
    turnId: varchar("turn_id", { length: 32 }).notNull(),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull(),
    threadId: varchar("thread_id", { length: 32 })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    requestId: varchar("request_id", { length: 64 }),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }),
    operation: varchar("operation", { length: 32 }).notNull(),
    targetItemId: varchar("target_item_id", { length: 32 }),
    historyItemId: varchar("history_item_id", { length: 32 }),
    historyRevision: bigint("history_revision", { mode: "bigint" }),
    status: varchar("status", { length: 20 }).notNull(),
    error: text("error"),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true, precision: 6 }),
  },
  (t) => [
    primaryKey({ columns: [t.turnId, t.attemptEpoch] }),
    foreignKey({
      columns: [t.threadId, t.turnId],
      foreignColumns: [threadTurns.threadId, threadTurns.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.threadId, t.targetItemId],
      foreignColumns: [threadItems.threadId, threadItems.id],
    }),
    foreignKey({
      columns: [t.threadId, t.historyItemId],
      foreignColumns: [threadItems.threadId, threadItems.id],
    }),
    uniqueIndex("ux_turn_attempts_thread_request").on(t.threadId, t.requestId),
    index("ix_turn_attempts_turn_started").on(t.turnId, t.startedAt),
    index("ix_turn_attempts_history_item").on(t.historyItemId),
  ],
);

/** Frozen, non-secret reconstruction facts for one physical attempt. A recovery
 * claim copies this envelope to its new epoch before any host resource starts. */
export const turnResumeEnvelopes = pgTable(
  "turn_resume_envelopes",
  {
    turnId: varchar("turn_id", { length: 32 }).notNull(),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull(),
    threadId: varchar("thread_id", { length: 32 })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    historyItemId: varchar("history_item_id", { length: 32 }).notNull(),
    historyRevision: bigint("history_revision", { mode: "bigint" }).notNull(),
    historyDigest: varchar("history_digest", { length: 64 }).notNull(),
    instructionDigest: varchar("instruction_digest", { length: 64 }).notNull(),
    toolCatalogDigest: varchar("tool_catalog_digest", { length: 64 }).notNull(),
    workspaceDigest: varchar("workspace_digest", { length: 64 }).notNull(),
    compactorVersion: varchar("compactor_version", { length: 64 }).notNull(),
    remoteBinding: text("remote_binding"),
    snapshot: jsonb("snapshot_json").$type<PersistedTurnResumeSnapshot>().notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.turnId, t.attemptEpoch] }),
    foreignKey({
      columns: [t.turnId, t.attemptEpoch],
      foreignColumns: [turnAttempts.turnId, turnAttempts.attemptEpoch],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.threadId, t.historyItemId],
      foreignColumns: [threadItems.threadId, threadItems.id],
    }),
    index("ix_turn_resume_envelopes_thread").on(t.threadId, t.createdAt),
  ],
);

/** Synchronous input admission and delivery state for a live Turn. */
export const turnInputs = pgTable(
  "turn_inputs",
  {
    turnId: varchar("turn_id", { length: 32 })
      .notNull()
      .references(() => threadTurns.id, { onDelete: "cascade" }),
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
  sourceHistoryRevision: bigint("source_history_revision", { mode: "bigint" }).notNull(),
  sourceHistoryDigest: varchar("source_history_digest", { length: 64 }).notNull(),
  instructionDigest: varchar("instruction_digest", { length: 64 }).notNull(),
  toolCatalogDigest: varchar("tool_catalog_digest", { length: 64 }).notNull(),
  workspaceDigest: varchar("workspace_digest", { length: 64 }).notNull(),
  compactorVersion: varchar("compactor_version", { length: 64 }).notNull(),
  remoteBinding: text("remote_binding"),
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
      .references(() => threadTurns.id, { onDelete: "cascade" }),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull(),
    heartbeatAt: timestamp("heartbeat_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    uniqueIndex("ux_turn_leases_turn_id").on(t.turnId),
    foreignKey({
      columns: [t.turnId, t.attemptEpoch],
      foreignColumns: [turnAttempts.turnId, turnAttempts.attemptEpoch],
    }).onDelete("cascade"),
  ],
);

/** Model/tool trace projection. It is observable state, not the journal authority. */
export const turnSteps = pgTable(
  "turn_steps",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    turnId: varchar("turn_id", { length: 32 })
      .notNull()
      .references(() => threadTurns.id, { onDelete: "cascade" }),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull(),
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
    uniqueIndex("ux_turn_steps_turn_attempt_step").on(t.turnId, t.attemptEpoch, t.stepIndex),
    foreignKey({
      columns: [t.turnId, t.attemptEpoch],
      foreignColumns: [turnAttempts.turnId, turnAttempts.attemptEpoch],
    }).onDelete("cascade"),
  ],
);

export const toolEffects = pgTable(
  "tool_effects",
  {
    id: varchar("id", { length: 64 }).notNull(),
    turnId: varchar("turn_id", { length: 32 })
      .notNull()
      .references(() => threadTurns.id, { onDelete: "cascade" }),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull(),
    itemId: varchar("item_id", { length: 32 }).references(() => threadItems.id, { onDelete: "set null" }),
    stepIndex: integer("step_index"),
    toolName: varchar("tool_name", { length: 80 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    inputDigest: varchar("input_digest", { length: 64 }).notNull(),
    inputJson: jsonb("input_json").$type<unknown>(),
    outputJson: jsonb("output_json").$type<unknown>(),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    completedAt: timestamp("completed_at", { mode: "date", withTimezone: true, precision: 6 }),
  },
  (t) => [
    primaryKey({ columns: [t.turnId, t.id] }),
    index("ix_tool_effects_turn_id").on(t.turnId),
    index("ix_tool_effects_tool_name").on(t.toolName),
    foreignKey({
      columns: [t.turnId, t.attemptEpoch],
      foreignColumns: [turnAttempts.turnId, turnAttempts.attemptEpoch],
    }).onDelete("cascade"),
  ],
);

export const turnSandboxExecutions = pgTable(
  "turn_sandbox_executions",
  {
    turnId: varchar("turn_id", { length: 32 })
      .notNull()
      .references(() => threadTurns.id, { onDelete: "cascade" }),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull(),
    workspaceGeneration: bigint("workspace_generation", { mode: "bigint" }).notNull(),
    threadId: varchar("thread_id", { length: 32 })
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    state: varchar("state", { length: 20 }).notNull(),
    sandboxId: varchar("sandbox_id", { length: 128 }),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true, precision: 6 }),
    lastError: text("last_error"),
    terminalOutcome: varchar("terminal_outcome", { length: 32 }),
    finalizationSummary: jsonb("finalization_summary").$type<PersistedWorkspaceFinalizationSummary | null>(),
    finalizedAt: timestamp("finalized_at", { mode: "date", withTimezone: true, precision: 6 }),
    releasedAt: timestamp("released_at", { mode: "date", withTimezone: true, precision: 6 }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.turnId, t.attemptEpoch] }),
    index("ix_turn_sandbox_executions_releasing").on(t.state, t.updatedAt),
    foreignKey({
      columns: [t.turnId, t.attemptEpoch],
      foreignColumns: [turnAttempts.turnId, turnAttempts.attemptEpoch],
    }).onDelete("cascade"),
  ],
);

/** Immutable file mutations committed by one sandbox attempt. */
export const workspaceEffects = pgTable(
  "workspace_effects",
  {
    id: varchar("id", { length: 64 }).notNull(),
    threadId: varchar("thread_id", { length: 32 }).notNull(),
    turnId: varchar("turn_id", { length: 32 }).notNull(),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull(),
    producer: varchar("producer", { length: 32 }).notNull(),
    toolCallId: varchar("tool_call_id", { length: 128 }),
    operation: varchar("operation", { length: 12 }).notNull(),
    fileId: varchar("file_id", { length: 32 }).notNull(),
    workspacePath: varchar("workspace_path", { length: 1024 }).notNull(),
    baseRevisionId: uuid("base_revision_id"),
    resultRevisionId: uuid("result_revision_id"),
    basePathGeneration: bigint("base_path_generation", { mode: "bigint" }),
    resultPathGeneration: bigint("result_path_generation", { mode: "bigint" }),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.turnId, t.id] }),
    index("ix_workspace_effects_attempt").on(t.turnId, t.attemptEpoch, t.createdAt),
    index("ix_workspace_effects_file").on(t.threadId, t.fileId, t.createdAt),
    foreignKey({
      columns: [t.threadId, t.turnId],
      foreignColumns: [threadTurns.threadId, threadTurns.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.turnId, t.attemptEpoch],
      foreignColumns: [turnAttempts.turnId, turnAttempts.attemptEpoch],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.threadId, t.fileId],
      foreignColumns: [threadFiles.threadId, threadFiles.id],
    }).onDelete("cascade"),
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
    uniqueIndex("ux_thread_files_idempotency").on(t.threadId, t.idempotencyKey),
    uniqueIndex("ux_thread_files_live_workspace_path")
      .on(t.threadId, t.workspacePath)
      .where(sql`${t.workspaceState} = 'live'`),
  ],
);

/** Immutable agent publication of an exact durable file revision. */
export const artifactOccurrences = pgTable(
  "artifact_occurrences",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    threadId: varchar("thread_id", { length: 32 }).notNull(),
    turnId: varchar("turn_id", { length: 32 }).notNull(),
    attemptEpoch: bigint("attempt_epoch", { mode: "bigint" }).notNull(),
    toolCallId: varchar("tool_call_id", { length: 128 }).notNull(),
    artifactIndex: integer("artifact_index").notNull(),
    workspaceEffectId: varchar("workspace_effect_id", { length: 64 }).notNull(),
    fileId: varchar("file_id", { length: 32 }).notNull(),
    assetId: uuid("asset_id").notNull(),
    revisionId: uuid("revision_id").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    workspacePath: varchar("workspace_path", { length: 1024 }).notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    uniqueIndex("ux_artifact_occurrences_publication").on(t.turnId, t.attemptEpoch, t.toolCallId, t.artifactIndex),
    index("ix_artifact_occurrences_file_revision").on(t.threadId, t.fileId, t.revisionId),
    index("ix_artifact_occurrences_attempt").on(t.turnId, t.attemptEpoch, t.artifactIndex),
    foreignKey({
      columns: [t.threadId, t.turnId],
      foreignColumns: [threadTurns.threadId, threadTurns.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.turnId, t.attemptEpoch],
      foreignColumns: [turnAttempts.turnId, turnAttempts.attemptEpoch],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.threadId, t.fileId],
      foreignColumns: [threadFiles.threadId, threadFiles.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.turnId, t.workspaceEffectId],
      foreignColumns: [workspaceEffects.turnId, workspaceEffects.id],
    }),
  ],
);

export const threadFileSaveOperations = pgTable(
  "thread_file_save_operations",
  {
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
    primaryKey({ columns: [t.threadId, t.operationId] }),
    index("ix_thread_file_save_operations_file").on(t.fileId, t.createdAt),
    index("ix_thread_file_save_operations_pending")
      .on(t.status, t.leaseUntil)
      .where(sql`${t.status} = 'pending'`),
  ],
);

export const assetClaimIntents = pgTable(
  "asset_claim_intents",
  {
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
    primaryKey({ columns: [t.ownerType, t.ownerId, t.slot] }),
    index("ix_asset_claim_intents_due").on(t.deliveredAt, t.nextAttemptAt, t.leaseUntil),
  ],
);

export const threadArtifactCleanupOutbox = pgTable(
  "thread_artifact_cleanup_outbox",
  {
    threadId: varchar("thread_id", { length: 32 }).primaryKey(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    claimedAt: timestamp("claimed_at", { mode: "date", withTimezone: true, precision: 6 }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [index("ix_thread_artifact_cleanup_outbox_available").on(t.availableAt, t.createdAt)],
);
