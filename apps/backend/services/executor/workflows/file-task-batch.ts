import path from "node:path";

import { getWorkflowMetadata } from "workflow";
import { z } from "zod";

import { buildFileTextModel, generateFileContent } from "../src/application/files/generator.js";
import { observeTaskCancellation } from "../src/application/tasks/cancellation.js";
import { isTaskCancelled, reportTaskProgress } from "../src/application/tasks/notify.js";
import { getSettings } from "../src/bootstrap/config.js";
import { writeChangeSetFile } from "../src/infrastructure/clients/knowledge.js";

const relativePath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\:*?"<>|]+$/);

const fileTaskSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9-]*$/),
  instruction: z.string().min(1).max(12_000),
  outputPath: relativePath,
});

export const fileTaskBatchInputSchema = z
  .object({
    orgId: z.string().min(1),
    userId: z.string().min(1),
    providerId: z.string().min(1),
    stagingId: z.string().min(1),
    sharedContext: z.string().min(1).max(40_000),
    tasks: z.array(fileTaskSchema).min(1).max(100),
  })
  .superRefine((input, context) => {
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const [index, task] of input.tasks.entries()) {
      if (ids.has(task.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tasks", index, "id"],
          message: "task ids must be unique",
        });
      }
      if (paths.has(task.outputPath)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tasks", index, "outputPath"],
          message: "output paths must be unique",
        });
      }
      ids.add(task.id);
      paths.add(task.outputPath);
    }
  });

export type FileTaskBatchInput = z.infer<typeof fileTaskBatchInputSchema>;

function mimeFor(target: string): string {
  const extension = path.extname(target).toLowerCase();
  if (extension === ".html" || extension === ".htm") {
    return "text/html";
  }
  if (extension === ".css") {
    return "text/css";
  }
  if (extension === ".js" || extension === ".mjs" || extension === ".ts") {
    return "text/javascript";
  }
  if (extension === ".json") {
    return "application/json";
  }
  if (extension === ".md" || extension === ".markdown") {
    return "text/markdown";
  }
  if (extension === ".svg") {
    return "image/svg+xml";
  }
  if (extension === ".xml") {
    return "application/xml";
  }
  return "text/plain";
}

async function generateFileStep(input: {
  batch: FileTaskBatchInput;
  task: FileTaskBatchInput["tasks"][number];
}): Promise<{ id: string; path: string }> {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  const cancellation = observeTaskCancellation(workflowRunId);
  console.log("[file-task-batch] generate start", {
    id: input.task.id,
    path: input.task.outputPath,
  });
  try {
    const tools = await buildFileTextModel(input.batch.providerId, input.batch.orgId);
    const content = await generateFileContent({
      outputPath: input.task.outputPath,
      taskId: input.task.id,
      sharedContext: input.batch.sharedContext,
      instruction: input.task.instruction,
      tools,
      abortSignal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(5 * 60_000)]),
    });
    if (cancellation.signal.aborted || (await isTaskCancelled(workflowRunId))) {
      throw new DOMException("task cancelled", "AbortError");
    }
    await writeChangeSetFile({
      userId: input.batch.userId,
      changeSetId: input.batch.stagingId,
      path: input.task.outputPath,
      content,
      mimeType: mimeFor(input.task.outputPath),
    });
    console.log("[file-task-batch] generate done", {
      id: input.task.id,
      path: input.task.outputPath,
    });
    return { id: input.task.id, path: input.task.outputPath };
  } finally {
    cancellation.dispose();
  }
}

async function reportProgressStep(done: number, total: number) {
  "use step";
  const { workflowRunId } = getWorkflowMetadata();
  await reportTaskProgress(workflowRunId, { done, total }).catch(() => undefined);
}

async function concurrencyStep() {
  "use step";
  return getSettings().fileTaskConcurrency;
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const result: R[] = new Array(values.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (index < values.length) {
        const current = index++;
        result[current] = await worker(values[current]);
      }
    }),
  );
  return result;
}

export async function fileTaskBatchWorkflow(input: FileTaskBatchInput) {
  "use workflow";
  console.log("[file-task-batch] workflow start", { total: input.tasks.length });
  const concurrency = await concurrencyStep();
  await reportProgressStep(0, input.tasks.length);
  let done = 0;
  const files = await mapConcurrent(input.tasks, concurrency, async (task) => {
    const result = await generateFileStep({ batch: input, task });
    done += 1;
    await reportProgressStep(done, input.tasks.length);
    return result;
  });
  console.log("[file-task-batch] workflow done", { total: files.length });
  return {
    stagingId: input.stagingId,
    files,
  };
}
