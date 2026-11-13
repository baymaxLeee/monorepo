import { experimental_createWebFetchTool as createWebFetchTool } from "@ai-sdk/tool-web-fetch";
import { createUploadArtifactsTool } from "@backend/agent-runtime-ts/artifact";
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
    createUploadArtifactsTool(
      (input, options) =>
        requireRunSandbox(options.experimental_sandbox).save(input, options.toolCallId, options.abortSignal),
      { contextSchema: artifactToolContextSchema },
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
