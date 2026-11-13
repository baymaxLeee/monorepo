import { experimental_createWebFetchTool as createWebFetchTool } from "@ai-sdk/tool-web-fetch";
import { createBashTool } from "@backend/agent-runtime-ts/bash";
import { defineAgentTool, transformToolPreservingCaller } from "@backend/agent-runtime-ts/manifest";
import { toolCompleted, toolFailed } from "@backend/agent-runtime-ts/outcome";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { artifactToolContextSchema } from "../context.js";
import { createAgentCodeModeTool } from "./code-mode.js";
import { requireRunSandbox } from "./sandbox-session.js";

export async function createRuntimeTools() {
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
    createBashTool(async (input, options) => {
      options.abortSignal?.throwIfAborted();
      return requireRunSandbox(options.experimental_sandbox).run({
        command: input.command,
        workingDirectory: input.workdir ?? "/workspace/work",
        abortSignal: options.abortSignal,
      });
    }),
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
      "save_sandbox_file",
      tool({
        description:
          "Display one completed workspace file as a deliverable. File bytes already persist automatically. Use operation=create for a file first created in this run. Use update with the restored file_id and ETag when publishing an edited existing file; its authoritative path is already writable in /workspace. Never turn a conflict into create automatically.",
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
