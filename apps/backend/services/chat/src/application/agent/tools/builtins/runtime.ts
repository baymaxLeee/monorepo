import { experimental_createWebFetchTool as createWebFetchTool } from "@ai-sdk/tool-web-fetch";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { artifactToolContextSchema } from "../context.js";
import { defineAgentTool, transformToolPreservingCaller } from "../manifest.js";
import { toolCompleted, toolFailed, toolPartial } from "../outcome.js";
import { createAgentCodeModeTool } from "./code-mode.js";
import { requireRunSandbox } from "./sandbox-session.js";

export async function createRuntimeTools() {
  const commandResult = (result: { exitCode: number; stdout: string; stderr: string }) =>
    result.exitCode === 0
      ? toolCompleted(result)
      : toolPartial(result, {
          code: "COMMAND_FAILED",
          message: result.stderr || `Command exited with code ${result.exitCode}`,
          retryable: false,
          source: "bash",
        });
  const webFetchBase = createWebFetchTool();
  const webFetch = transformToolPreservingCaller(
    webFetchBase,
    (definition) =>
      ({
        ...definition,
        description:
          "Read one known public URL and return its main content as Markdown or text. Use this tool directly for one URL. For two or more independent URLs, or when results need programmatic filtering or aggregation, use code_mode. Do not use web_fetch to discover sources; use web_search instead. JavaScript-rendered pages may return little content.",
      }) as ToolSet[string],
  );
  const code = createAgentCodeModeTool();
  const readPolicy = {
    capability: "search" as const,
    effect: "read" as const,
    trust: "open-world" as const,
    execution: "inline" as const,
    modes: ["normal", "plan"] as ("normal" | "plan")[],
  };
  const manifests = [
    defineAgentTool(
      "web_fetch",
      {
        ...webFetch,
        execute: async (input, options) => {
          const result = await webFetchBase.execute(input, options);
          options.abortSignal?.throwIfAborted();
          if (!("type" in result)) throw new Error("Web Fetch returned an unexpected streaming result.");
          return result.type === "error"
            ? toolFailed({ code: result.errorCode, message: result.message, retryable: false, source: "web-fetch" })
            : toolCompleted(result);
        },
      },
      { ...readPolicy, callableByCodeMode: true },
      { summary: "Read a public web page or text URL as Markdown.", parallelizable: true },
    ),
    defineAgentTool(
      "bash",
      tool({
        description:
          "Run real Bash through this run's AI SDK sandbox session for file, CLI, raw-response, or program execution work. Do not use Bash for ordinary public web discovery or page reading: use web_search for one query, web_fetch for one known URL, and code_mode for multiple public reads with programmatic aggregation. Bash supports curl only through the configured egress proxy, plus Python, Node, CLI programs and file create/read/edit/delete. The initial working directory is /workspace/work; /workspace/outputs is writable; /workspace/sources contains read-only original conversation attachments and saved files. Copy a source into work before editing. State and files persist across commands in this run; shell variables/cwd do not. Use save_sandbox_file for every deliverable before the run ends. No host mounts, service credentials, sudo or unsandboxed fallback.",
        inputSchema: z.object({
          command: z
            .string()
            .min(1)
            .max(65536)
            .describe("Bash command or script. Prefer explicit paths and quoted heredocs for file content."),
          workdir: z.string().default("/workspace/work").describe("Existing absolute workspace directory."),
        }),
        contextSchema: artifactToolContextSchema,
        execute: async (input, options) => {
          options.abortSignal?.throwIfAborted();
          const sandbox = requireRunSandbox(options.experimental_sandbox);
          return commandResult(
            await sandbox.run({
              command: input.command,
              workingDirectory: input.workdir,
              abortSignal: options.abortSignal,
            }),
          );
        },
      }),
      {
        ...readPolicy,
        capability: "files",
        effect: "write",
        trust: "private-untrusted",
        modes: ["normal", "plan"],
        uiKind: "terminal",
      },
      {
        summary: "Execute CLI programs and manipulate real files in a run-scoped Linux sandbox.",
        constraints: ["Temporary files disappear when the run ends. Save deliverables explicitly."],
      },
    ),
    defineAgentTool(
      "refresh_conversation_sources",
      tool({
        description:
          "Refresh /workspace/sources after another tool publishes a new conversation attachment or saved artifact during this run. The first Bash call imports existing sources automatically, so do not call this before ordinary discovery or reading. Returns only newly imported or updated source paths; use Bash to inspect and read them. Working copies in work/ and outputs/ are preserved.",
        inputSchema: z.object({}),
        contextSchema: artifactToolContextSchema,
        execute: async (_input, options) =>
          requireRunSandbox(options.experimental_sandbox).refresh(options.abortSignal),
      }),
      { ...readPolicy, capability: "files", effect: "read", modes: ["normal"] },
      { summary: "Import conversation sources added by another tool after the sandbox was initialized." },
    ),
    defineAgentTool(
      "checkout_conversation_file",
      tool({
        description:
          "Create or replace a writable working copy from an exact imported conversation-file revision. Use this before editing an existing saved file and again after refresh when rebasing onto a newer ETag. This copies the source bytes and binds that work path to the supplied file_id and ETag; refresh alone never upgrades an existing working copy.",
        inputSchema: z.object({
          file_id: z.string().length(32).describe("Stable file id from sources/saved/manifest.json."),
          etag: z
            .string()
            .regex(/^\"[a-f0-9]{32}\"$/)
            .describe("Exact ETag from sources/saved/manifest.json."),
          path: z.string().min(1).describe("Destination under /workspace/work or /workspace/outputs."),
        }),
        contextSchema: artifactToolContextSchema,
        execute: async (input, options) =>
          requireRunSandbox(options.experimental_sandbox).checkoutFile(
            { fileId: input.file_id, etag: input.etag, path: input.path },
            options.abortSignal,
          ),
      }),
      { ...readPolicy, capability: "files", effect: "write", trust: "private-untrusted", modes: ["normal", "plan"] },
      { summary: "Create a fenced writable copy of an imported conversation file revision." },
    ),
    defineAgentTool(
      "save_sandbox_file",
      tool({
        description:
          "Save one completed sandbox file. Use operation=create for a new artifact or intentional Save As. For update, first use checkout_conversation_file for the exact imported ETag, edit that bound working path, then save it with the same file_id and ETag. Update supports bounded UTF-8 text, preserves file identity, and returns a new ETag. Refresh alone never rebases a work copy; never turn a conflict into create automatically.",
        inputSchema: z.object({
          operation: z.enum(["create", "update"]),
          path: z.string().min(1).describe("Completed file path under /workspace/work or /workspace/outputs."),
          filename: z
            .string()
            .min(1)
            .max(255)
            .regex(/^[^/\\\x00-\x1f]+$/)
            .nullable()
            .describe("Required for create; null for update."),
          media_type: z.string().min(1).max(255).nullable().describe("Required for create; null for update."),
          title: z.string().min(1).max(255).nullable().describe("Required for create; null for update."),
          file_id: z.string().length(32).nullable().describe("Required for update; null for create."),
          etag: z
            .string()
            .regex(/^"[a-f0-9]{32}"$/)
            .nullable()
            .describe("Read baseline for update; null for create."),
        }),
        contextSchema: artifactToolContextSchema,
        execute: async (input, options) => {
          const sandbox = requireRunSandbox(options.experimental_sandbox);
          if (input.operation === "create") {
            if (!input.filename || !input.media_type || !input.title || input.file_id !== null || input.etag !== null) {
              throw new Error("Create requires filename, media_type and title; file_id and etag must be null.");
            }
            return sandbox.save(
              {
                operation: "create",
                path: input.path,
                filename: input.filename,
                media_type: input.media_type,
                title: input.title,
              },
              options.toolCallId,
              options.abortSignal,
            );
          }
          if (
            !input.file_id ||
            !input.etag ||
            input.filename !== null ||
            input.media_type !== null ||
            input.title !== null
          ) {
            throw new Error("Update requires file_id and etag; filename, media_type and title must be null.");
          }
          return sandbox.save(
            { operation: "update", path: input.path, file_id: input.file_id, etag: input.etag },
            options.toolCallId,
            options.abortSignal,
          );
        },
      }),
      {
        ...readPolicy,
        capability: "files",
        effect: "add",
        trust: "closed",
        modes: ["normal", "plan"],
        uiKind: "artifact",
      },
      { summary: "Create a conversation artifact or update an imported editable text file with CAS." },
    ),
    defineAgentTool("code_mode", code, readPolicy, {
      summary: "Use JavaScript to search and fetch public sources concurrently, then filter or combine their results.",
      constraints: [
        "Only explicitly eligible read tools are callable from generated code; business writes and approvals remain direct tools.",
      ],
    }),
  ];
  return { manifests, dispose: async () => {} };
}
