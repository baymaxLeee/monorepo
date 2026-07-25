import type { z } from "zod";

export interface TaskTypeDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly inputSchema: z.ZodType<TInput, z.ZodTypeDef, any>;
  readonly workflow: (input: TInput) => Promise<TOutput>;
  readonly cancel?: (input: TInput, progress: TaskProgress | null, context: { taskId: string }) => Promise<void>;
}

export type TaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface TaskProgress {
  done: number;
  total: number;
  externalTaskIds?: string[];
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
