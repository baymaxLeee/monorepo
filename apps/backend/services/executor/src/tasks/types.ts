import type { z } from "zod";

// A TaskType is the seam future runtimes (harness-backed execution, etc.)
// plug into: the HTTP/business layer only ever depends on this shape, never
// on how `workflow` is invoked internally. See agent_task_执行时服务 plan
// Phase 3 ("generalize-task-abstraction").
export interface TaskTypeDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  // The third generic (Input) is left as `any` on purpose: schemas with
  // `.default()`/`.optional()` fields have a pre-parse Input type that
  // differs from their post-parse Output type (TInput), which ZodType's
  // default single-generic form can't express.
  readonly inputSchema: z.ZodType<TInput, z.ZodTypeDef, any>;
  readonly workflow: (input: TInput) => Promise<TOutput>;
}

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TaskProgress {
  done: number;
  total: number;
}

export interface TaskSnapshot {
  id: string;
  type: string;
  status: TaskStatus;
  ownerService: string;
  ownerRef: string;
  result: unknown;
  progress: TaskProgress | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
}
