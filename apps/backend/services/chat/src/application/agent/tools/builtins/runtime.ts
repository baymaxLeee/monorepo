import { experimental_createCodeModeTool as createCodeModeTool } from "@ai-sdk/code-mode";
import { experimental_createWebFetchTool as createWebFetchTool } from "@ai-sdk/tool-web-fetch";
import { tool } from "ai";
import { z } from "zod";

import { artifactToolContextSchema } from "../context.js";
import { defineAgentTool } from "../manifest.js";
import { toolCompleted, toolFailed, toolPartial } from "../outcome.js";
import { RunSandbox, type SandboxDependencies } from "./sandbox-session.js";

export async function createRuntimeTools(deps?: SandboxDependencies) {
  const session = new RunSandbox(deps);
  const commandResult = (result: Awaited<ReturnType<RunSandbox["start"]>>) =>
    result.exitCode === null || result.exitCode === 0
      ? toolCompleted(result)
      : toolPartial(result, {
          code: result.timed_out ? "COMMAND_TIMEOUT" : "COMMAND_FAILED",
          message: result.timed_out
            ? "Command timed out; this run's sandbox was destroyed, including detached processes."
            : result.stderr || `Command exited with code ${result.exitCode}`,
          retryable: false,
          source: "bash",
        });
  try {
    const webFetch = createWebFetchTool();
    const code = createCodeModeTool({ web_fetch: webFetch });
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
        readPolicy,
        { summary: "Read a public web page or text URL as Markdown.", parallelizable: true },
      ),
      defineAgentTool(
        "bash",
        tool({
          description:
            "Run real Bash in the isolated Linux workspace for this run. Supports curl (through the configured egress proxy), Python, Node, CLI programs and file create/read/edit/delete. The initial working directory is /workspace/work; /workspace/outputs is writable; /workspace/sources contains read-only original conversation attachments and saved files. Copy a source into work before editing. State and files persist across commands in this run; shell variables/cwd do not. An unfinished command returns session_id and exitCode=null: use write_stdin to continue. Use save_sandbox_file for every deliverable before the run ends. A timeout destroys this sandbox, including all processes. No host mounts, service credentials, sudo or unsandboxed fallback.",
          inputSchema: z.object({
            command: z
              .string()
              .min(1)
              .max(65536)
              .describe("Bash command or script. Prefer explicit paths and quoted heredocs for file content."),
            workdir: z.string().default("/workspace/work").describe("Existing absolute workspace directory."),
            tty: z.boolean().default(false).describe("Enable a PTY for interactive terminal programs."),
            yield_time_ms: z
              .number()
              .int()
              .min(0)
              .max(10000)
              .default(1000)
              .describe("Wait for completion this long, then return a process session."),
            timeout_ms: z
              .number()
              .int()
              .positive()
              .default(120000)
              .describe("Hard wall-clock deadline for the command; configured service maximum applies."),
          }),
          contextSchema: artifactToolContextSchema,
          execute: async (input, options) =>
            commandResult(await session.start(input, options.context, options.toolCallId, options.abortSignal)),
        }),
        {
          ...readPolicy,
          capability: "files",
          effect: "write",
          trust: "private-untrusted",
          modes: ["normal"],
          uiKind: "terminal",
        },
        {
          summary: "Execute CLI programs and manipulate real files in a run-scoped Linux sandbox.",
          constraints: ["Temporary files disappear when the run ends. Save deliverables explicitly."],
        },
      ),
      defineAgentTool(
        "write_stdin",
        tool({
          description:
            "Send input to or poll a Bash process session from this run. Empty chars polls incremental output; \u0003 sends Ctrl-C. Use the returned exitCode to determine completion.",
          inputSchema: z.object({
            session_id: z.string(),
            chars: z.string().max(65536).default(""),
            yield_time_ms: z.number().int().min(0).max(10000).default(1000),
          }),
          contextSchema: artifactToolContextSchema,
          execute: async (input, options) =>
            commandResult(await session.write(input, options.context, options.toolCallId, options.abortSignal)),
        }),
        { ...readPolicy, capability: "files", effect: "write", modes: ["normal"], uiKind: "terminal" },
        { summary: "Continue a running shell command or interactive program." },
      ),
      defineAgentTool(
        "load_conversation_files",
        tool({
          description:
            "Import current conversation attachments and saved artifacts into /workspace/sources and return their exact sandbox paths. Bash does this automatically once on first use. Call again to load files saved by other tools during this run. Working copies in work/ and outputs/ are preserved.",
          inputSchema: z.object({}),
          contextSchema: artifactToolContextSchema,
          execute: async (_input, options) => session.load(options.context, options.abortSignal),
        }),
        { ...readPolicy, capability: "files", effect: "read", modes: ["normal"] },
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
            media_type: z
              .string()
              .min(1)
              .max(255)
              .describe("File MIME type, for example application/pdf or text/html."),
            title: z.string().min(1).max(255).describe("User-visible artifact title."),
          }),
          contextSchema: artifactToolContextSchema,
          execute: async (input, options) =>
            session.save(input, options.context, options.toolCallId, options.abortSignal),
        }),
        { ...readPolicy, capability: "files", effect: "add", trust: "closed", modes: ["normal"], uiKind: "artifact" },
        { summary: "Persist and publish a sandbox file as a conversation artifact." },
      ),
      defineAgentTool("code_mode", code, readPolicy, {
        summary: "Use JavaScript to fetch public pages concurrently and filter or combine their results.",
        constraints: [
          "Only web_fetch is callable from generated code; business writes and approvals remain direct tools.",
        ],
      }),
    ];
    return {
      manifests,
      dispose: async () => {
        await session.dispose();
      },
    };
  } catch (error) {
    await session.dispose();
    throw error;
  }
}
