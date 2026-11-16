import { createUploadArtifactsTool } from "@repo/agent-runtime/protocol/artifact";
import { createBashTool } from "@repo/agent-runtime/tools/bash";
import { defineAgentTool } from "@repo/agent-runtime/tools/manifest";
import { tool } from "ai";
import { z } from "zod";

import { artifactToolContextSchema } from "../tools/context.js";
import { requireRunSandbox } from "./cloud-sandbox.js";

export async function createCloudToolAdapters() {
  const readPolicy = {
    capability: "search" as const,
    effect: "read" as const,
    trust: "open-world" as const,
    execution: "inline" as const,
    modes: ["normal", "plan"] as ("normal" | "plan")[],
  };
  const manifests = [
    createBashTool(async (input, options) => {
      options.abortSignal?.throwIfAborted();
      return requireRunSandbox(options.experimental_sandbox).run({
        command: input.command,
        workingDirectory: input.workdir ?? "/workspace/work",
        abortSignal: options.abortSignal,
      });
    }),
    defineAgentTool(
      "refresh_session_sources",
      tool({
        description:
          "Refresh /workspace/sources after another tool publishes a new session attachment or saved artifact during this run. The first Bash call imports existing sources automatically, so do not call this before ordinary discovery or reading. Returns only newly imported or updated source paths; use Bash to inspect and read them. Working copies in work/ and outputs/ are preserved.",
        inputSchema: z.object({}),
        contextSchema: artifactToolContextSchema,
        execute: async (_input, options) =>
          requireRunSandbox(options.experimental_sandbox).refresh(options.abortSignal),
      }),
      { ...readPolicy, capability: "files", effect: "read", modes: ["normal"] },
      { summary: "Import session sources added by another tool after the sandbox was initialized." },
    ),
    createUploadArtifactsTool(
      (input, options) =>
        requireRunSandbox(options.experimental_sandbox).save(input, options.toolCallId, options.abortSignal),
      { contextSchema: artifactToolContextSchema },
    ),
  ];
  return { manifests, dispose: async () => {} };
}
