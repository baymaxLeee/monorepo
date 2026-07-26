import path from "node:path";

import { TransportError } from "@backend/transport-ts";
import type { ChatProvider } from "@backend/transport-ts/provider-model";
import { tool } from "ai";
import { z } from "zod";

import {
  createFileChangeSet,
  discardFileChangeSet,
  listVirtualFiles,
  promoteFileChangeSet,
  readVirtualFile,
  searchVirtualFiles,
  writeChangeSetFile,
} from "../../../../infrastructure/clients/knowledge.js";
import { setActivePlanPath } from "../../../conversations.js";
import type { AgentMode } from "../../agents/types.js";
import { pollTaskSnapshots, startExecutorTask } from "../../tasks/executor-task.js";
import { artifactToolContextSchema, fileToolContextSchema, type ArtifactToolContext, type FileToolContext } from "../context.js";
import { defineAgentTool } from "../manifest.js";
import { toolCompleted, toolFailed, toolRunning, ToolBlockedError, type ToolEmission } from "../outcome.js";
import type { AgentToolPolicy } from "../types.js";

const listFilesOutputSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
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
const searchFilesOutputSchema = z.object({
  matches: z.array(
    z.object({
      path: z.string(),
      line: z.number(),
      column: z.number(),
      text: z.string(),
    }),
  ),
  truncated: z.boolean(),
});
const textPath = z
  .string()
  .min(1)
  .max(512)
  .regex(/^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[^\\:*?"<>|]+$/)
  .describe("Relative virtual file path. Never use an absolute path or '..'.");
const sha = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .describe("Optional SHA-256 returned by a previous read or write; use it to reject stale mutations.");

const writeInput = z.object({
  path: textPath,
  content: z.string().max(500_000).describe("The complete exact UTF-8 file content. This is not a brief or generation plan."),
  expected_sha256: sha.optional(),
});
const editInput = z.object({
  path: textPath,
  edits: z
    .array(
      z.object({
        old_text: z.string().min(1).max(80_000).describe("Exact text currently present in the file."),
        new_text: z.string().max(80_000).describe("Exact replacement text; use an empty string to delete old_text."),
        replace_all: z.boolean().optional().describe("Set true only when every occurrence should be replaced; otherwise old_text must be unique."),
      }),
    )
    .min(1)
    .max(100)
    .describe("Atomic replacement list. Even one replacement must be wrapped in this edits array."),
  expected_sha256: sha.optional(),
});
const fileOutput = z.object({
  path: z.string(),
  sha256: z.string(),
  total_chars: z.number(),
});
const editOutput = fileOutput.extend({
  replacements: z.number(),
  first_changed_line: z.number(),
  diff: z.string(),
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
    tasks: z.array(delegatedTask).min(1).max(100).describe("Independent complete-file tasks. Outputs must not depend on one another."),
  })
  .superRefine((input, context) => {
    const root = input.root.replace(/\/+$/, "");
    const prefix = `${root}/`;
    const ids = new Set<string>();
    const paths = new Set<string>();
    for (const [index, task] of input.tasks.entries()) {
      if (!task.output_path.startsWith(prefix)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tasks", index, "output_path"],
          message: "output_path must be inside root",
        });
      }
      if (ids.has(task.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["tasks", index, "id"],
          message: "task ids must be unique",
        });
      }
      if (paths.has(task.output_path)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
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
  return {
    files: rows
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
  };
}

async function readFile(
  input: { path: string; offset: number; limit: number },
  { context }: { context: FileToolContext },
): Promise<z.infer<typeof readFileOutputSchema> | ToolEmission> {
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

async function searchFiles(
  input: { pattern: string; path?: string; glob?: string },
  { context }: { context: FileToolContext },
): Promise<z.infer<typeof searchFilesOutputSchema>> {
  const matches = await searchVirtualFiles({
    userId: context.userId,
    conversationId: context.conversationId,
    pattern: input.pattern,
    path: input.path || undefined,
    glob: input.glob,
  });
  return { matches, truncated: matches.length >= 200 };
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

function isHtml(target: string): boolean {
  return mimeFor(target) === "text/html";
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
      limit: 400,
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
    orgId: input.context.orgId,
    conversationId: input.context.conversationId,
    metadata: {
      kind: isHtml(input.target) ? "html" : "text",
      root: input.target,
    },
  });
  const entry = await writeChangeSetFile({
    userId: input.context.userId,
    changeSetId: changeSet.id,
    path: input.target,
    content: input.content,
    mimeType: mimeFor(input.target),
  });
  return { entry, changeSetId: changeSet.id };
}

async function writeFileUnlocked(input: z.infer<typeof writeInput>, { context }: { context: ArtifactToolContext }) {
  if (planPath(input.path)) {
    assertPlan(input.content);
  }
  const change = await createTextChangeSet({
    target: input.path,
    content: input.content,
    expectedSha: input.expected_sha256,
    context,
  });
  await promoteFileChangeSet({ userId: context.userId, changeSetId: change.changeSetId });
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

function applyEdits(
  original: string,
  edits: z.infer<typeof editInput>["edits"],
): { content: string; ranges: Array<{ start: number; end: number; newText: string }> } {
  const ranges: Array<{ start: number; end: number; newText: string }> = [];
  for (const edit of edits) {
    const starts: number[] = [];
    for (let start = original.indexOf(edit.old_text); start >= 0; start = original.indexOf(edit.old_text, start + edit.old_text.length)) {
      starts.push(start);
      if (!edit.replace_all) {
        break;
      }
    }
    if (starts.length === 0 || (!edit.replace_all && starts[0] !== original.lastIndexOf(edit.old_text))) {
      throw new ToolBlockedError({
        code: "EDIT_TARGET_NOT_UNIQUE",
        message: "old_text must occur exactly once unless replace_all is true",
        retryable: true,
        source: "chat",
      });
    }
    for (const start of starts) {
      const end = start + edit.old_text.length;
      if (ranges.some((range) => start < range.end && end > range.start)) {
        throw new ToolBlockedError({
          code: "EDIT_TARGET_OVERLAP",
          message: "edit targets must not overlap",
          retryable: true,
          source: "chat",
        });
      }
      ranges.push({ start, end, newText: edit.new_text });
    }
  }
  let content = original;
  for (const range of [...ranges].sort((left, right) => right.start - left.start)) {
    content = `${content.slice(0, range.start)}${range.newText}${content.slice(range.end)}`;
  }
  return { content, ranges };
}

async function editFileUnlocked(input: z.infer<typeof editInput>, { context }: { context: ArtifactToolContext }): Promise<z.infer<typeof editOutput>> {
  const current = await readCurrent(context, input.path);
  if (!current.writable) {
    throw new ToolBlockedError({
      code: "FILE_READ_ONLY",
      message: `${input.path} is read-only`,
      retryable: false,
      source: "knowledge",
      details: { path: input.path },
    });
  }
  if (input.expected_sha256 && input.expected_sha256 !== current.sha256) {
    throw new ToolBlockedError({
      code: "FILE_SHA_MISMATCH",
      message: "file changed since the caller last read it",
      retryable: true,
      source: "knowledge",
      details: { path: input.path, actual_sha256: current.sha256 },
    });
  }
  const edited = applyEdits(current.content, input.edits);
  const change = await createTextChangeSet({
    target: input.path,
    content: edited.content,
    expectedSha: current.sha256,
    context,
  });
  await promoteFileChangeSet({ userId: context.userId, changeSetId: change.changeSetId });
  const firstChanged = Math.min(...edited.ranges.map((range) => range.start));
  return {
    path: change.entry.path,
    sha256: change.entry.sha256,
    total_chars: edited.content.length,
    replacements: edited.ranges.length,
    first_changed_line: current.content.slice(0, firstChanged).split("\n").length,
    diff: input.edits.map((edit) => `-${edit.old_text}\n+${edit.new_text}`).join("\n"),
  };
}

function editFile(input: z.infer<typeof editInput>, options: { context: ArtifactToolContext }) {
  return withMutation(`${options.context.userId}:${options.context.conversationId}:${input.path}`, () => editFileUnlocked(input, options));
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
  textProvider: ChatProvider,
) {
  const root = `${input.root.replace(/\/+$/, "")}/`;
  const expectedPaths = input.tasks.map((item) => item.output_path);
  const displayPath = expectedPaths[0];
  const changeSet = await createFileChangeSet({
    userId: context.userId,
    orgId: context.orgId,
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
          orgId: context.orgId,
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
    for await (const snapshot of pollTaskSnapshots(task.id, task.ownerRef, abortSignal)) {
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

export function createFileToolManifests(_mode: AgentMode, textProvider: ChatProvider) {
  return [
    defineAgentTool(
      "list_files",
      tool({
        description: "List files attached to the current conversation, including generated artifacts.",
        inputSchema: z.object({
          path: z.string().max(512).optional().describe("Optional relative directory prefix. Omit or use an empty string to list all files."),
        }),
        outputSchema: listFilesOutputSchema,
        contextSchema: fileToolContextSchema,
        execute: listFiles,
      }),
      fileReadPolicy,
      { summary: "List source files and generated artifacts attached to the conversation." },
    ),
    defineAgentTool(
      "read_file",
      tool({
        description: "Read a bounded slice of a conversation file. Continue from next_offset when present.",
        inputSchema: z.object({
          path: z.string().min(1).max(512).describe("Exact path returned by list_files or another file tool."),
          offset: z.number().int().min(1).default(1).describe("One-based starting line. Use next_offset from the previous result to continue."),
          limit: z.number().int().min(1).max(400).default(200).describe("Maximum number of lines to return."),
        }),
        outputSchema: readFileOutputSchema,
        contextSchema: fileToolContextSchema,
        execute: readFile,
      }),
      fileReadPolicy,
      { summary: "Read bounded slices of a conversation file." },
    ),
    defineAgentTool(
      "search_files",
      tool({
        description: "Search attached text files with a bounded regular expression scan.",
        inputSchema: z.object({
          pattern: z.string().min(1).max(500).describe("Regular expression to search for."),
          path: z.string().max(512).optional().describe("Optional file or directory path. Omit or use an empty string to search all attached text files."),
          glob: z.string().max(120).optional().describe("Optional file glob such as '**/*.html'. Omit when no filename filter is needed."),
        }),
        inputExamples: [{ input: { pattern: "pointerdown|touchstart", glob: "**/*.html" } }],
        outputSchema: searchFilesOutputSchema,
        contextSchema: fileToolContextSchema,
        execute: searchFiles,
      }),
      fileReadPolicy,
      { summary: "Search attached text files by regular expression." },
    ),
    defineAgentTool(
      "write_file",
      tool({
        description:
          "Write exact complete UTF-8 text to a relative virtual path and publish the new version immediately. " +
          "Use for new files and coherent rewrites when an existing file is too broadly or structurally changed for reliable exact edits. " +
          "Chart-bearing HTML must follow core_policy's platform-first ECharts Promise-loader contract.",
        inputSchema: writeInput,
        inputExamples: [
          {
            input: {
              path: "report.html",
              content: "<!doctype html><html><body><main>Report</main></body></html>",
            },
          },
        ],
        outputSchema: fileOutput,
        contextSchema: artifactToolContextSchema,
        execute: writeFile,
      }),
      artifactFilePolicy("write", ["normal", "plan"]),
      { summary: "Write a complete text file." },
    ),
    defineAgentTool(
      "edit_file",
      tool({
        description:
          "Atomically apply exact old_text/new_text replacements and publish immediately. Each old_text must be unique unless its optional replace_all flag is true. " +
          "Prefer this for modifications to an existing file when targeted replacements can preserve the surrounding work; batch independent replacements when practical. " +
          "When editing chart-bearing HTML, preserve or repair core_policy's platform-first ECharts Promise-loader contract.",
        inputSchema: editInput,
        inputExamples: [
          {
            input: {
              path: "report.html",
              edits: [{ old_text: "<main>Old</main>", new_text: "<main>New</main>" }],
            },
          },
        ],
        outputSchema: editOutput,
        contextSchema: artifactToolContextSchema,
        execute: editFile,
      }),
      artifactFilePolicy("update", ["normal"]),
      { summary: "Precisely edit a text file." },
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
        uiKind: "artifact",
      },
      {
        summary: "Materialize independent file tasks with durable bounded fan-out.",
        parallelizable: true,
        constraints: ["Use direct write_file/edit_file for simple or sequential work.", "Every task must own a unique output path."],
      },
    ),
  ];
}
