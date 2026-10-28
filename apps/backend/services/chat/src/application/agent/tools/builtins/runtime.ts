import { experimental_createCodeModeTool as createCodeModeTool } from "@ai-sdk/code-mode";
import { createJustBashNetworkSandboxSession } from "@ai-sdk/sandbox-just-bash";
import { experimental_createBashTool as createBashTool } from "@ai-sdk/tool-bash";
import { experimental_createWebFetchTool as createWebFetchTool } from "@ai-sdk/tool-web-fetch";

import { defineAgentTool } from "../manifest.js";
import { toolCompleted, toolFailed, toolPartial } from "../outcome.js";

export async function createRuntimeTools() {
  // The default just-bash session has an in-memory filesystem and no network.
  // Never mount service files or inject process.env into model-executed commands.
  const session = await createJustBashNetworkSandboxSession();
  try {
    const bash = await createBashTool({ sandbox: session.restricted() });
    bash.description = `${bash.description}\nThis is a temporary scratch filesystem for this run, not the conversation file store. Network access is disabled. Use write_file or edit_file to persist deliverables.`;
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
        {
          ...bash,
          execute: async (input, options) => {
            const result = await bash.execute(input, options);
            options.abortSignal?.throwIfAborted();
            if (!("exitCode" in result)) throw new Error("Bash returned an unexpected streaming result.");
            return result.exitCode === 0
              ? toolCompleted(result)
              : toolPartial(result, {
                  code: "COMMAND_FAILED",
                  message: result.stderr || `Command exited with code ${result.exitCode}`,
                  retryable: false,
                  source: "bash",
                });
          },
        },
        { ...readPolicy, capability: "files", effect: "none", trust: "closed", uiKind: "terminal" },
        {
          summary: "Compute and transform data in an isolated, temporary shell.",
          constraints: ["Scratch files are discarded when the run ends; persist deliverables using file tools."],
        },
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
        await session.destroy();
      },
    };
  } catch (error) {
    await session.destroy();
    throw error;
  }
}
