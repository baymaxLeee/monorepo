import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { createUploadArtifactsTool, type PublishedWorkspaceFile } from "../protocol/artifact.js";
import {
  applyPatchToText,
  createApplyPatchTool,
  parseApplyPatch,
  type AppliedFileChange,
} from "../tools/apply-patch.js";
import { createBashTool, type BashInput } from "../tools/bash.js";
import { deferAgentToolLoading, defineAgentTool } from "../tools/manifest.js";
import { createReadFileTool, type TextFileSnapshot } from "../tools/read-file.js";
import type { AgentToolManifest } from "../tools/types.js";
import { createWriteFileTool, type FileWriteResult } from "../tools/write-file.js";
import type { ExecutionEnvironment } from "./environment.js";
import type { FileToolAuthority } from "./file-system.js";
import type { SandboxAttempt, SandboxAttemptResult, ToolOrchestrator } from "./tool-orchestrator.js";

export interface ExecutionHostFileSystem<CONTEXT extends Record<string, unknown>> {
  readText(
    input: { path: string },
    authority: FileToolAuthority,
    options: ToolExecutionOptions<CONTEXT>,
  ): Promise<TextFileSnapshot | null>;
  writeText(
    input: { path: string; content: string; mode: "create" | "overwrite"; expectedSha256?: string },
    authority: FileToolAuthority,
    options: ToolExecutionOptions<CONTEXT>,
  ): Promise<FileWriteResult>;
  deleteFile(
    input: { path: string; expectedSha256: string },
    authority: FileToolAuthority,
    options: ToolExecutionOptions<CONTEXT>,
  ): Promise<void>;
}

export interface ExecutionHost<CONTEXT extends Record<string, unknown> = Record<string, unknown>> {
  environment: ExecutionEnvironment;
  orchestrator: ToolOrchestrator;
  run(input: BashInput, attempt: SandboxAttempt, options: ToolExecutionOptions<CONTEXT>): Promise<SandboxAttemptResult>;
  files: ExecutionHostFileSystem<CONTEXT>;
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
    createBashTool((input, execution) =>
      host.orchestrator.runBash(execution.toolCallId, input, (attempt) =>
        host.run(input, attempt, execution as ToolExecutionOptions<CONTEXT>),
      ),
    ),
    createReadFileTool((input, execution) =>
      host.orchestrator.runFileTool(execution.toolCallId, "read_file", input, async (authority) => {
        const path = authority.accesses[0]?.path;
        if (!path) throw new Error("read_file admission did not resolve a path");
        const snapshot = await host.files.readText({ path }, authority, execution as ToolExecutionOptions<CONTEXT>);
        if (!snapshot) {
          const error = new Error(`File does not exist: ${path}`);
          Object.assign(error, { code: "FILE_NOT_FOUND" });
          throw error;
        }
        return { path, ...snapshot };
      }),
    ),
    createApplyPatchTool((input, execution) =>
      host.orchestrator.runFileTool(execution.toolCallId, "apply_patch", input, async (authority) => {
        const patch = parseApplyPatch(input.patch);
        if (patch.paths.length !== authority.accesses.length) {
          throw new Error("apply_patch admission path set changed before execution");
        }
        const resolved = new Map(patch.paths.map((path, index) => [path, authority.accesses[index]!.path]));
        const changes: AppliedFileChange[] = [];
        const partial = (error: unknown): never => {
          if (error && typeof error === "object") Object.assign(error, { changes: [...changes] });
          else {
            const wrapped = new Error(String(error));
            Object.assign(wrapped, { changes: [...changes] });
            throw wrapped;
          }
          throw error;
        };
        try {
          for (const action of patch.actions) {
            const path = resolved.get(action.path)!;
            if (action.type === "add") {
              const written = await host.files.writeText(
                { path, content: action.content, mode: "create" },
                authority,
                execution as ToolExecutionOptions<CONTEXT>,
              );
              changes.push({ type: "add", path, sha256: written.sha256 });
              continue;
            }
            const snapshot = await host.files.readText({ path }, authority, execution as ToolExecutionOptions<CONTEXT>);
            if (!snapshot) {
              const error = new Error(`File does not exist: ${path}`);
              Object.assign(error, { code: "FILE_NOT_FOUND" });
              throw error;
            }
            if (action.type === "delete") {
              await host.files.deleteFile(
                { path, expectedSha256: snapshot.sha256 },
                authority,
                execution as ToolExecutionOptions<CONTEXT>,
              );
              changes.push({ type: "delete", path, before_sha256: snapshot.sha256 });
              continue;
            }
            const content = applyPatchToText(snapshot.content, action);
            if (action.moveTo) {
              const destination = resolved.get(action.moveTo)!;
              const written = await host.files.writeText(
                { path: destination, content, mode: "create" },
                authority,
                execution as ToolExecutionOptions<CONTEXT>,
              );
              changes.push({ type: "add", path: destination, sha256: written.sha256 });
              await host.files.deleteFile(
                { path, expectedSha256: snapshot.sha256 },
                authority,
                execution as ToolExecutionOptions<CONTEXT>,
              );
              changes.push({ type: "delete", path, before_sha256: snapshot.sha256 });
            } else if (content !== snapshot.content) {
              const written = await host.files.writeText(
                { path, content, mode: "overwrite", expectedSha256: snapshot.sha256 },
                authority,
                execution as ToolExecutionOptions<CONTEXT>,
              );
              changes.push({ type: "update", path, sha256: written.sha256, before_sha256: snapshot.sha256 });
            }
          }
        } catch (error) {
          partial(error);
        }
        return { changes };
      }),
    ),
    createWriteFileTool((input, execution) =>
      host.orchestrator.runFileTool(execution.toolCallId, "write_file", input, async (authority) => {
        const path = authority.accesses[0]?.path;
        if (!path) throw new Error("write_file admission did not resolve a path");
        return host.files.writeText(
          {
            path,
            content: input.content,
            mode: input.mode,
            ...(input.expected_sha256 ? { expectedSha256: input.expected_sha256 } : {}),
          },
          authority,
          execution as ToolExecutionOptions<CONTEXT>,
        );
      }),
    ),
    createUploadArtifactsTool(host.deliver, options),
  ];
  if (host.refreshSources) {
    manifests.splice(
      4,
      0,
      deferAgentToolLoading(
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
          },
          { summary: "Refresh external session sources without changing workspace files." },
        ),
      ),
    );
  }
  return manifests;
}
