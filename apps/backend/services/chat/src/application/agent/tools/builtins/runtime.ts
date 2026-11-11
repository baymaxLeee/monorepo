import { experimental_codeModeTool as codeModeTool } from "@ai-sdk/code-mode";
import { experimental_createWebFetchTool as createWebFetchTool } from "@ai-sdk/tool-web-fetch";
import { tool } from "ai";
import { z } from "zod";

import { artifactToolContextSchema } from "../context.js";
import { defineAgentTool } from "../manifest.js";
import { toolCompleted, toolFailed, toolPartial } from "../outcome.js";
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
  const webFetch = createWebFetchTool();
  const code = codeModeTool({ toolDiscovery: "conversation" });
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
          const result = await webFetch.execute(input, options);
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
          "Run real Bash through this run's AI SDK sandbox session. Supports curl (through the configured egress proxy), Python, Node, CLI programs and file create/read/edit/delete. The initial working directory is /workspace/work; /workspace/outputs is writable; /workspace/sources contains read-only original conversation attachments and saved files. Copy a source into work before editing. State and files persist across commands in this run; shell variables/cwd do not. Use save_sandbox_file for every deliverable before the run ends. No host mounts, service credentials, sudo or unsandboxed fallback.",
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
      "load_conversation_files",
      tool({
        description:
          "Import current conversation attachments and saved artifacts into /workspace/sources and return their exact sandbox paths. Bash does this automatically once on first use. Call again to load files saved by other tools during this run. Working copies in work/ and outputs/ are preserved.",
        inputSchema: z.object({}),
        contextSchema: artifactToolContextSchema,
        execute: async (_input, options) => requireRunSandbox(options.experimental_sandbox).load(options.abortSignal),
      }),
      { ...readPolicy, capability: "files", effect: "read", modes: ["normal", "plan"] },
      { summary: "Load current saved conversation files into the sandbox." },
    ),
    defineAgentTool(
      "save_sandbox_file",
      tool({
        description:
          "Publish one completed sandbox file to the conversation. Uploads its exact bytes to Asset and registers a downloadable artifact; supports text, HTML, images, PDF, spreadsheets, archives and other binary files. Local edits and deletions do not change saved artifacts. Each save creates an immutable artifact snapshot. Save before finishing; unsaved files are lost when this run ends.",
        inputSchema: z.object({
          path: z.string().min(1).describe("File path under /workspace, such as /workspace/outputs/report.xlsx."),
          filename: z
            .string()
            .min(1)
            .max(255)
            .regex(/^[^/\\\x00-\x1f]+$/)
            .describe("Download filename including extension."),
          media_type: z.string().min(1).max(255).describe("File MIME type, for example application/pdf or text/html."),
          title: z.string().min(1).max(255).describe("User-visible artifact title."),
        }),
        contextSchema: artifactToolContextSchema,
        execute: async (input, options) =>
          requireRunSandbox(options.experimental_sandbox).save(input, options.toolCallId, options.abortSignal),
      }),
      {
        ...readPolicy,
        capability: "files",
        effect: "add",
        trust: "closed",
        modes: ["normal", "plan"],
        uiKind: "artifact",
      },
      { summary: "Persist and publish a sandbox file as a conversation artifact." },
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
