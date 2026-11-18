import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { createUploadArtifactsTool, type PublishedWorkspaceFile } from "../protocol/artifact.js";
import { createBashTool, type BashInput, type BashResult } from "../tools/bash.js";
import { defineAgentTool } from "../tools/manifest.js";
import type { AgentToolManifest } from "../tools/types.js";
import type { ExecutionEnvironment } from "./execution-environment.js";

export interface ExecutionHost<CONTEXT extends Record<string, unknown> = Record<string, unknown>> {
  environment: ExecutionEnvironment;
  run(input: BashInput, options: ToolExecutionOptions<CONTEXT>): Promise<BashResult>;
  deliver(path: string, options: ToolExecutionOptions<CONTEXT>): Promise<PublishedWorkspaceFile>;
  refreshSources?(options: ToolExecutionOptions<CONTEXT>): Promise<unknown>;
}

export function createExecutionHostManifests<CONTEXT extends Record<string, unknown> = Record<string, unknown>>(
  host: ExecutionHost<CONTEXT>,
  options: { contextSchema?: z.ZodType<CONTEXT> } = {},
): AgentToolManifest[] {
  if (Boolean(host.refreshSources) !== (host.environment.workspace.externalSources === "read-only")) {
    throw new Error("execution host source refresh must match the advertised external source capability");
  }
  const manifests: AgentToolManifest[] = [
    createBashTool((input, execution) => host.run(input, execution as ToolExecutionOptions<CONTEXT>)),
    createUploadArtifactsTool(host.deliver, options),
  ];
  if (host.refreshSources) {
    manifests.splice(
      1,
      0,
      defineAgentTool(
        "refresh_session_sources",
        tool({
          description:
            "Refresh read-only external sources after another tool adds or updates a session resource during this turn. Existing workspace files are preserved.",
          inputSchema: z.object({}),
          ...(options.contextSchema ? { contextSchema: options.contextSchema } : {}),
          execute: (_input, execution) => host.refreshSources!(execution as ToolExecutionOptions<CONTEXT>),
        }),
        {
          capability: "files",
          effect: "read",
          trust: "closed",
          execution: "inline",
          modes: ["normal"],
        },
        { summary: "Refresh external session sources without changing workspace files." },
      ),
    );
  }
  return manifests;
}
