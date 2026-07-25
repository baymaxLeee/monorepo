import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import type { TaskProgress } from "../../application/tasks/types.js";
import type {
  CostEntryPayload,
  ProductionArtifactProvenance,
  VideoProductionProjection,
} from "../../domain/video-production/contracts.js";

export const tasks = pgTable(
  "tasks",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    type: varchar("type", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    ownerService: varchar("owner_service", { length: 40 }).notNull(),
    ownerRef: varchar("owner_ref", { length: 80 }).notNull(),
    workflowRunId: varchar("workflow_run_id", { length: 64 }),
    payload: jsonb("payload").$type<unknown>().notNull(),
    result: jsonb("result").$type<unknown>(),
    progress: jsonb("progress").$type<TaskProgress | null>(),
    error: text("error"),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true, precision: 6 }),
  },
  (t) => [
    uniqueIndex("ux_tasks_owner").on(t.ownerService, t.ownerRef),
    index("ix_tasks_workflow_run_id").on(t.workflowRunId),
  ],
);

export const videoProductions = pgTable(
  "video_productions",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    taskId: varchar("task_id", { length: 32 }).notNull(),
    orgId: varchar("org_id", { length: 32 }).notNull(),
    userId: varchar("user_id", { length: 32 }).notNull(),
    conversationId: varchar("conversation_id", { length: 32 }),
    status: varchar("status", { length: 32 }).notNull(),
    stage: varchar("stage", { length: 48 }).notNull(),
    version: integer("version").notNull(),
    projection: jsonb("projection").$type<VideoProductionProjection>().notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true, precision: 6 }),
  },
  (t) => [
    uniqueIndex("ux_video_productions_task_id").on(t.taskId),
    index("ix_video_productions_conversation_id").on(t.conversationId),
  ],
);

export const videoProductionArtifacts = pgTable(
  "video_production_artifacts",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    productionId: varchar("production_id", { length: 32 }).notNull(),
    artifactType: varchar("artifact_type", { length: 40 }).notNull(),
    version: integer("version").notNull(),
    inputSha256: varchar("input_sha256", { length: 64 }).notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    provenance: jsonb("provenance").$type<ProductionArtifactProvenance>().notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    uniqueIndex("ux_video_production_artifact_version").on(t.productionId, t.artifactType, t.version),
    index("ix_video_production_artifacts_production_id").on(t.productionId),
  ],
);

export const videoProductionEvents = pgTable(
  "video_production_events",
  {
    id: serial("id").primaryKey(),
    productionId: varchar("production_id", { length: 32 }).notNull(),
    sequence: integer("sequence").notNull(),
    kind: varchar("kind", { length: 64 }).notNull(),
    stage: varchar("stage", { length: 48 }).notNull(),
    actorId: varchar("actor_id", { length: 32 }),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    uniqueIndex("ux_video_production_event_sequence").on(t.productionId, t.sequence),
    index("ix_video_production_events_production_id").on(t.productionId),
  ],
);

export const videoProductionDecisions = pgTable(
  "video_production_decisions",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    productionId: varchar("production_id", { length: 32 }).notNull(),
    actionId: varchar("action_id", { length: 80 }).notNull(),
    action: varchar("action", { length: 40 }).notNull(),
    expectedVersion: integer("expected_version").notNull(),
    actorId: varchar("actor_id", { length: 32 }).notNull(),
    reason: text("reason"),
    status: varchar("status", { length: 24 }).notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
    deliveredAt: timestamp("delivered_at", { mode: "date", withTimezone: true, precision: 6 }),
  },
  (t) => [
    uniqueIndex("ux_video_production_decision_action").on(t.productionId, t.actionId),
    index("ix_video_production_decisions_production_id").on(t.productionId),
  ],
);

export const videoCostEntries = pgTable(
  "video_cost_entries",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    productionId: varchar("production_id", { length: 32 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 120 }).notNull(),
    kind: varchar("kind", { length: 24 }).notNull(),
    amountMicros: bigint("amount_micros", { mode: "number" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    payload: jsonb("payload").$type<CostEntryPayload>().notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true, precision: 6 }).notNull(),
  },
  (t) => [
    uniqueIndex("ux_video_cost_entry_idempotency").on(t.productionId, t.idempotencyKey),
    index("ix_video_cost_entries_production_id").on(t.productionId),
  ],
);
