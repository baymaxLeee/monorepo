import { TransportError } from "@backend/transport-ts";
import type { LanguageProviderSnapshot } from "@backend/transport-ts/provider-model";
import { tool } from "ai";
import { z } from "zod";

import {
  createFileChangeSet,
  discardFileChangeSet,
  listVirtualFiles,
  listDocuments,
  getDocument,
  promoteFileChangeSet,
  readVirtualFile,
  writeChangeSetFile,
} from "../../../../infrastructure/clients/knowledge.js";
import { setActivePlanPath } from "../../../conversations.js";
import type { AgentMode } from "../../agents/types.js";
import { startExecutorTask, watchTaskSnapshots } from "../../tasks/executor-task.js";
import { artifactToolContextSchema, fileToolContextSchema, type ArtifactToolContext, type FileToolContext } from "../context.js";
import { defineAgentTool } from "../manifest.js";
import { toolCompleted, toolFailed, toolRunning, ToolBlockedError, type ToolEmission } from "../outcome.js";
import type { AgentToolPolicy } from "../types.js";

const listFilesOutputSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      document_id: z.string().optional(),
      title: z.string(),
      filename: z.string(),
      kind: z.string(),
      mime_type: z.string(),
      size: z.number().nullable(),
      status: z.string(),
      updated_at: z.string(),
      writable: z.boolean(),
      derived: z.boolean(),
    }),
  ),
});
const readFileOutputSchema = z.object({
  path: z.string(),
  title: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  offset: z.number(),
  total_lines: z.number(),
  next_offset: z.number().nullable(),
  sha256: z.string(),
  content: z.string(),
  untrusted: z.boolean(),
});
const textPath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\:*?"<>|]+$/)
  .describe("Relative conversation file path. Never use an absolute path or '..'.");
const sha = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe("Optional SHA-256 returned by a previous read or write; use it to reject stale mutations.");

const writeInput = z.object({
  path: textPath,
  content: z.string().describe("The complete exact UTF-8 file content. This is not a brief or generation plan."),
  expected_sha256: sha.optional(),
});
const fileOutput = z.object({
  path: z.string(),
  sha256: z.string(),
  total_chars: z.number(),
});
const delegatedTask = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z][a-z0-9-]*$/)
    .describe("Unique lowercase task id using letters, digits, and hyphens."),
  instruction: z.string().min(1).max(12_000).describe("Self-contained instructions for generating exactly one complete file."),
  output_path: textPath.describe("Unique output path inside root, including the root prefix."),
});
const delegateInput = z
  .object({
    root: textPath.describe("Relative directory that contains every task output_path."),
    shared_context: z.string().min(1).max(40_000).describe("Immutable facts and conventions shared by every independent task."),
    tasks: z.array(delegatedTask).min(2).max(100).describe("Independent complete-file tasks. Outputs must not depend on one another."),
  })
  .superRefine((input, context) => {
    const root = input.root.replace(/\/+$/, "");
    const prefix = `${root}/`;
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const [index, task] of input.tasks.entries()) {
      if (!task.output_path.startsWith(prefix)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "output_path"],
          message: "output_path must be inside root",
        });
      }
      if (ids.has(task.id)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "id"],
          message: "task ids must be unique",
        });
      }
      if (paths.has(task.output_path)) {
        context.addIssue({
          code: "custom",
          path: ["tasks", index, "output_path"],
          message: "output paths must be unique",
        });
      }
      ids.add(task.id);
      paths.add(task.output_path);
    }
  });
const delegateOutput = z.object({
  path: z.string(),
  task_id: z.string(),
  done: z.number(),
  total: z.number(),
  paths: z.array(z.string()),
});

async function listFiles(input: { path?: string }, { context }: { context: FileToolContext }) {
  const requestedPath = input.path || undefined;
  const rows = await listVirtualFiles(context.userId, context.conversationId, requestedPath);
  const documents = await listDocuments(context.userId, context.conversationId);
  return {
    files: [
      ...rows
        .filter((row) => !requestedPath || row.path.startsWith(`${requestedPath.replace(/\/+$/, "")}/`))
        .map((row) => ({
          path: row.path,
          title: row.path.split("/").at(-1) ?? row.path,
          filename: row.path,
          kind: row.derived ? "derived" : "text",
          mime_type: row.mime_type,
          size: row.size,
          status: row.writable ? "ready" : "readonly",
          updated_at: "",
          writable: row.writable,
          derived: row.derived,
        })),
      ...documents
        .filter((doc) => !requestedPath || `documents/${doc.id}`.startsWith(`${requestedPath}/`))
        .map((doc) => ({
          path: `documents/${doc.id}`,
          document_id: doc.id,
          title: doc.title,
          filename: doc.filename,
          kind: doc.kind,
          mime_type: doc.mime_type,
          size: doc.source_size,
          status: doc.ingest_status,
          updated_at: doc.updated_at,
          writable: false,
          derived: false,
        })),
    ],
  };
}

async function readFile(
  input: { path: string; offset: number; limit: number },
  { context }: { context: FileToolContext },
): Promise<z.infer<typeof readFileOutputSchema> | ToolEmission> {
  if (input.path.startsWith("documents/")) {
    const doc = await getDocument(context.userId, input.path.slice("documents/".length));
    if (doc.conversation_id !== context.conversationId) throw new Error("file is not in this conversation");
    const lines = doc.content_md.split("\n");
    const end = input.offset - 1 + input.limit;
    return {
      path: input.path,
      title: doc.title,
      filename: doc.filename,
      mime_type: doc.mime_type,
      offset: input.offset,
      total_lines: lines.length,
      next_offset: end < lines.length ? end + 1 : null,
      sha256: doc.source_sha256 ?? "",
      content: lines.slice(input.offset - 1, end).join("\n"),
      untrusted: true,
    };
  }
  const slice = await readVirtualFile({
    userId: context.userId,
    conversationId: context.conversationId,
    path: input.path,
    offset: input.offset,
    limit: input.limit,
  });
  return {
    path: slice.path,
    title: slice.path.split("/").at(-1) ?? slice.path,
    filename: slice.path,
    mime_type: slice.mime_type,
    offset: slice.offset,
    total_lines: slice.total_lines,
    next_offset: slice.next_offset,
    sha256: slice.sha256,
    content: slice.content,
    untrusted: input.path.startsWith("sources/"),
  };
}

const mutationTails = new Map<string, Promise<void>>();

async function acquireMutation(key: string): Promise<() => void> {
  const previous = mutationTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  mutationTails.set(key, current);
  await previous;
  return () => {
    release();
    if (mutationTails.get(key) === current) {
      mutationTails.delete(key);
    }
  };
}

async function withMutation<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const release = await acquireMutation(key);
  try {
    return await operation();
  } finally {
    release();
  }
}

function planPath(target: string): boolean {
  return /(?:^|\/)\S+-plan\.md$/i.test(target);
}

function assertPlan(content: string): void {
  const required = ["# 目标", "## 背景与约束", "## 实施方案", "## 任务", "## 验收标准"];
  if (required.some((heading) => !content.includes(heading)) || !/- \[ \] .+/.test(content)) {
    throw new Error("plan Markdown is missing required headings or unchecked tasks");
  }
}

async function readAll(reader: (offset: number) => Promise<Awaited<ReturnType<typeof readVirtualFile>>>) {
  let offset = 1;
  let first: Awaited<ReturnType<typeof readVirtualFile>> | null = null;
  const chunks: string[] = [];
  while (true) {
    const slice = await reader(offset);
    first ??= slice;
    chunks.push(slice.content);
    if (slice.next_offset === null) {
      return { ...first, content: chunks.join("\n"), next_offset: null };
    }
    offset = slice.next_offset;
  }
}

function readCurrent(context: ArtifactToolContext, target: string) {
  return readAll((offset) =>
    readVirtualFile({
      userId: context.userId,
      conversationId: context.conversationId,
      path: target,
      offset,
      limit: 2_000,
    }),
  );
}

async function optionalCurrent(context: ArtifactToolContext, target: string) {
  try {
    return await readCurrent(context, target);
  } catch (error) {
    if (error instanceof TransportError && error.status === 404) {
      return null;
    }
    throw error;
  }
}

async function createTextChangeSet(input: { target: string; content: string; expectedSha?: string; context: ArtifactToolContext }) {
  const existing = await optionalCurrent(input.context, input.target);
  if (existing && !existing.writable) {
    throw new ToolBlockedError({
      code: "FILE_READ_ONLY",
      message: `${input.target} is read-only`,
      retryable: false,
      source: "knowledge",
      details: { path: input.target },
    });
  }
  if (input.expectedSha && existing?.sha256 !== input.expectedSha) {
    throw new ToolBlockedError({
      code: "FILE_SHA_MISMATCH",
      message: "file changed since the caller last read it",
      retryable: true,
      source: "knowledge",
      details: { path: input.target, actual_sha256: existing?.sha256 },
    });
  }
  const changeSet = await createFileChangeSet({
    userId: input.context.userId,
    tenantId: input.context.tenantId,
    workspaceId: input.context.workspaceId,
    conversationId: input.context.conversationId,
    metadata: {
      kind: "plan",
      root: input.target,
    },
  });
  try {
    const entry = await writeChangeSetFile({
      userId: input.context.userId,
      changeSetId: changeSet.id,
      path: input.target,
      content: input.content,
      mimeType: "text/markdown",
    });
    return { entry, changeSetId: changeSet.id };
  } catch (error) {
    await discardFileChangeSet({ userId: input.context.userId, changeSetId: changeSet.id }).catch(() => {});
    throw error;
  }
}

async function writeFileUnlocked(input: z.infer<typeof writeInput>, { context }: { context: ArtifactToolContext }) {
  if (!planPath(input.path)) throw new Error("write_plan requires a *-plan.md path");
  assertPlan(input.content);
  const change = await createTextChangeSet({
    target: input.path,
    content: input.content,
    expectedSha: input.expected_sha256,
    context,
  });
  try {
    await promoteFileChangeSet({ userId: context.userId, changeSetId: change.changeSetId });
  } catch (error) {
    await discardFileChangeSet({ userId: context.userId, changeSetId: change.changeSetId }).catch(() => {});
    throw error;
  }
  if (planPath(input.path)) {
    await setActivePlanPath(context.conversationId, input.path);
  }
  return {
    path: change.entry.path,
    sha256: change.entry.sha256,
    total_chars: input.content.length,
  };
}

function writeFile(input: z.infer<typeof writeInput>, options: { context: ArtifactToolContext }) {
  return withMutation(`${options.context.userId}:${options.context.conversationId}:${input.path}`, () => writeFileUnlocked(input, options));
}

async function* delegateTasks(
  input: z.infer<typeof delegateInput>,
  {
    context,
    toolCallId,
    abortSignal,
  }: {
    context: ArtifactToolContext;
    toolCallId: string;
    abortSignal?: AbortSignal;
  },
  textProvider: LanguageProviderSnapshot,
) {
  const root = `${input.root.replace(/\/+$/, "")}/`;
  const expectedPaths = input.tasks.map((item) => item.output_path);
  const displayPath = expectedPaths[0];
  const changeSet = await createFileChangeSet({
    userId: context.userId,
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    conversationId: context.conversationId,
    metadata: {
      kind: "delegated-files",
      root,
    },
  });
  let settled = false;
  try {
    const task = await startExecutorTask(
      {
        type: "file-task-batch",
        ownerRef: toolCallId,
        payload: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          userId: context.userId,
          providerId: textProvider.id,
          stagingId: changeSet.id,
          sharedContext: input.shared_context,
          tasks: input.tasks.map((item) => ({
            id: item.id,
            instruction: item.instruction,
            outputPath: item.output_path,
          })),
        },
      },
      abortSignal,
    );
    yield toolRunning({
      path: displayPath,
      task_id: task.id,
      done: 0,
      total: input.tasks.length,
    });
    for await (const frame of watchTaskSnapshots(task.id, task.ownerRef, abortSignal)) {
      const snapshot = frame.task;
      if (snapshot.status === "failed" || snapshot.status === "cancelled") {
        settled = true;
        await discardFileChangeSet({
          userId: context.userId,
          changeSetId: changeSet.id,
        });
        yield toolFailed({
          code: snapshot.status === "cancelled" ? "TASK_CANCELLED" : "TASK_FAILED",
          message: snapshot.error ?? `delegated file batch ${snapshot.status}`,
          retryable: snapshot.status === "failed",
          source: "executor",
          details: { task_id: task.id },
        });
        return;
      }
      if (snapshot.status !== "completed") {
        yield toolRunning({
          path: displayPath,
          task_id: task.id,
          done: snapshot.progress?.done ?? 0,
          total: snapshot.progress?.total ?? input.tasks.length,
        });
        continue;
      }
      const result = snapshot.result as { files?: unknown } | null;
      const resultFiles = Array.isArray(result?.files) ? result.files : [];
      const paths = resultFiles.flatMap((candidate) => {
        if (!candidate || typeof candidate !== "object") {
          return [];
        }
        const outputPath = (candidate as { path?: unknown }).path;
        return typeof outputPath === "string" ? [outputPath] : [];
      });
      if (paths.length !== expectedPaths.length || expectedPaths.some((candidate) => !paths.includes(candidate))) {
        settled = true;
        await discardFileChangeSet({
          userId: context.userId,
          changeSetId: changeSet.id,
        });
        yield toolFailed({
          code: "DELEGATED_OUTPUT_INCOMPLETE",
          message: "delegated file batch did not materialize every requested path",
          retryable: true,
          source: "executor",
          details: { task_id: task.id, expected_paths: expectedPaths, actual_paths: paths },
        });
        return;
      }
      await withMutation(`${context.userId}:${context.conversationId}:${root}`, () =>
        promoteFileChangeSet({
          userId: context.userId,
          changeSetId: changeSet.id,
        }),
      );
      settled = true;
      yield toolCompleted({
        path: displayPath,
        task_id: task.id,
        done: paths.length,
        total: expectedPaths.length,
        paths,
      });
      return;
    }
  } finally {
    if (!settled) {
      await discardFileChangeSet({
        userId: context.userId,
        changeSetId: changeSet.id,
      }).catch(() => undefined);
    }
  }
}

const fileReadPolicy: Omit<AgentToolPolicy, "source"> = {
  capability: "files",
  effect: "read",
  trust: "private-untrusted",
  execution: "inline",
  modes: ["normal", "plan"],
};

function artifactFilePolicy(effect: "write" | "update", modes: AgentMode[]) {
  return {
    capability: "files" as const,
    effect,
    trust: "closed" as const,
    execution: "inline" as const,
    modes,
    uiKind: "artifact" as const,
  };
}

export function createFileToolManifests(_mode: AgentMode, textProvider: LanguageProviderSnapshot) {
  return [
    defineAgentTool(
      "list_conversation_files",
      tool({
        description:
          "List persisted conversation files and Plans. Temporary sandbox files are listed with bash; use load_conversation_files to import newly saved files.",
        inputSchema: z.object({
          path: z.string().max(512).optional().describe("Optional relative directory prefix. Omit or use an empty string to list all files."),
        }),
        outputSchema: listFilesOutputSchema,
        contextSchema: fileToolContextSchema,
        execute: listFiles,
      }),
      { ...fileReadPolicy, uiKind: "file-tree" },
      { summary: "List source files and generated artifacts attached to the conversation." },
    ),
    defineAgentTool(
      "read_conversation_file",
      tool({
        description:
          "Read a bounded text preview of a persisted conversation file or Plan. Use bash to read raw files in the sandbox. Continue from next_offset when present.",
        inputSchema: z.object({
          path: z.string().min(1).max(512).describe("Saved conversation path returned by list_conversation_files. Sandbox paths belong to bash."),
          offset: z.number().int().min(1).default(1).describe("One-based starting line. Use next_offset from the previous result to continue."),
          limit: z.number().int().min(1).max(2_000).default(2_000).describe("Maximum number of lines to return."),
        }),
        outputSchema: readFileOutputSchema,
        contextSchema: fileToolContextSchema,
        execute: readFile,
      }),
      fileReadPolicy,
      { summary: "Read bounded slices of a conversation file." },
    ),
    defineAgentTool(
      "write_plan",
      tool({
        description:
          "Persist the complete Plan Markdown at a *-plan.md conversation path. Requires # 目标, ## 背景与约束, ## 实施方案, ## 任务, ## 验收标准 and unchecked tasks. This is the only planning write; normal file editing uses bash and save_sandbox_file.",
        inputSchema: writeInput,
        outputSchema: fileOutput,
        contextSchema: artifactToolContextSchema,
        execute: writeFile,
      }),
      artifactFilePolicy("write", ["plan"]),
      { summary: "Persist the complete Plan." },
    ),
    defineAgentTool(
      "delegate_tasks",
      tool({
        description:
          "Durably materialize independent files with bounded parallel model calls. " +
          "Use only when genuinely independent complete outputs exceed the primary model's practical output or context budget. " +
          "This tool does not compose files or understand HTML structure. Delegated chart-bearing HTML receives the same " +
          "platform-first ECharts Promise-loader requirement as direct HTML.",
        inputSchema: delegateInput,
        inputExamples: [
          {
            input: {
              root: "course",
              shared_context: "Use the same terminology and navigation labels in every page.",
              tasks: [
                {
                  id: "chapter-one",
                  instruction: "Create the complete first chapter page.",
                  output_path: "course/chapter-one.html",
                },
                {
                  id: "chapter-two",
                  instruction: "Create the complete second chapter page.",
                  output_path: "course/chapter-two.html",
                },
              ],
            },
          },
        ],
        outputSchema: delegateOutput,
        contextSchema: artifactToolContextSchema,
        execute: ((input: z.infer<typeof delegateInput>, options: Parameters<typeof delegateTasks>[1]) => delegateTasks(input, options, textProvider)) as never,
      }),
      {
        capability: "files",
        effect: "add",
        trust: "closed",
        execution: "durable",
        modes: ["normal"],
        uiKind: "subagent",
      },
      {
        summary: "Materialize independent file tasks with durable bounded fan-out.",
        parallelizable: true,
        constraints: [
          "Use bash and save_sandbox_file for simple or sequential work; load_conversation_files imports this batch into the current sandbox.",
          "Every task must own a unique output path.",
        ],
      },
    ),
  ];
}
