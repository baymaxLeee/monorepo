import { datetime, index, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";

// Business record of a durable task. Execution truth (steps, retries, replay)
// lives in the Workflow World; this table is the authorization/business
// boundary — "who started this, for what, and is it done" — mirroring the
// chat service's agent_runs/Redis split (ADR-0013 in chat's docs/ADR).
export const tasks = mysqlTable(
  "tasks",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    type: varchar("type", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    ownerService: varchar("owner_service", { length: 40 }).notNull(),
    ownerRef: varchar("owner_ref", { length: 80 }).notNull(),
    workflowRunId: varchar("workflow_run_id", { length: 64 }),
    payload: json("payload").$type<unknown>().notNull(),
    result: json("result").$type<unknown>(),
    progress: json("progress").$type<{ done: number; total: number } | null>(),
    error: text("error"),
    createdAt: datetime("created_at", { mode: "date", fsp: 6 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 6 }).notNull(),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 6 }),
  },
  (t) => [
    // Idempotency: the same (service, ownerRef) must map to one task even if
    // the caller retries the start request (e.g. chat's write_file toolCallId).
    uniqueIndex("ux_tasks_owner").on(t.ownerService, t.ownerRef),
    index("ix_tasks_workflow_run_id").on(t.workflowRunId),
  ],
);
