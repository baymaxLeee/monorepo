import { index, jsonb, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import type { TaskProgress } from "../tasks/types.js";

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
