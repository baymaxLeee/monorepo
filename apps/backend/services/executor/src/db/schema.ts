import { datetime, index, json, mysqlTable, text, uniqueIndex, varchar } from "drizzle-orm/mysql-core";
import type { TaskProgress } from "../tasks/types.js";

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
    progress: json("progress").$type<TaskProgress | null>(),
    error: text("error"),
    createdAt: datetime("created_at", { mode: "date", fsp: 6 }).notNull(),
    updatedAt: datetime("updated_at", { mode: "date", fsp: 6 }).notNull(),
    finishedAt: datetime("finished_at", { mode: "date", fsp: 6 }),
  },
  (t) => [
    uniqueIndex("ux_tasks_owner").on(t.ownerService, t.ownerRef),
    index("ix_tasks_workflow_run_id").on(t.workflowRunId),
  ],
);
