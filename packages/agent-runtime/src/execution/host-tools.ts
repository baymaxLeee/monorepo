import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import type { ExecutionEnvironment } from "../context/environment.js";
import type { PublishedWorkspaceFile } from "../tools/artifacts.js";
import { createUploadArtifactsTool } from "../tools/artifacts.js";
import { createApplyPatchTool, type AppliedFileChange } from "../tools/files/apply-patch.js";
import { applyPatchToText } from "../tools/files/patch/file-update.js";
import { parseApplyPatch } from "../tools/files/patch/parser.js";
import { createReadFileTool, type TextFileSnapshot } from "../tools/files/read-file.js";
import { createWriteFileTool, type FileWriteResult } from "../tools/files/write-file.js";
import { deferAgentToolLoading, defineAgentTool } from "../tools/manifest.js";
import type { AgentToolManifest } from "../tools/types.js";
import type { ProcessIO } from "./command-sessions.js";
import type { FileToolAuthority } from "./file-access.js";
import type { SandboxAttempt, SandboxAttemptResult, ToolOrchestrator } from "./orchestrator.js";
import { commandForPolicy, createBashTool } from "./shell-tools.js";

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
  run(
    input: ReturnType<typeof commandForPolicy>,
    attempt: SandboxAttempt,
    options: ToolExecutionOptions<CONTEXT>,
    io: ProcessIO,
  ): Promise<SandboxAttemptResult>;
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
    createBashTool(host.orchestrator.commandSessions, (args, io, execution) => {
      const input = commandForPolicy(args);
      return host.orchestrator.runBash(execution.toolCallId, input, (attempt) =>
        host.run(
          input,
          { ...attempt, abortSignal: AbortSignal.any([attempt.abortSignal, io.signal]) },
          execution as ToolExecutionOptions<CONTEXT>,
          io,
        ),
      );
    }),
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
    createApplyPatchTool(async (input, execution) => {
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
        return await host.orchestrator.runFileTool(execution.toolCallId, "apply_patch", input, async (authority) => {
          const patch = parseApplyPatch(input);
          if (patch.paths.length !== authority.accesses.length) {
            throw new Error("apply_patch admission path set changed before execution");
          }
          const resolved = new Map(patch.paths.map((path, index) => [path, authority.accesses[index]!.path]));
          const addFile = async (path: string, content: string) => {
            const before = await host.files.readText({ path }, authority, execution as ToolExecutionOptions<CONTEXT>);
            const written = await host.files.writeText(
              {
                path,
                content,
                ...(before ? { mode: "overwrite", expectedSha256: before.sha256 } : { mode: "create" }),
              },
              authority,
              execution as ToolExecutionOptions<CONTEXT>,
            );
            changes.push({
              type: "add",
              path,
              sha256: written.sha256,
              ...(before ? { before_sha256: before.sha256 } : {}),
            });
          };
          for (const action of patch.actions) {
            const path = resolved.get(action.path)!;
            if (action.type === "add") {
              await addFile(path, action.content);
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
              if (destination === path) throw new Error("Cannot move a file onto itself");
              await addFile(destination, content);
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
          return { changes, affected: patch.actions.map(({ type, path }) => ({ type, path })) };
        });
      } catch (error) {
        return partial(error);
      }
    }),
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
      manifests.length - 1,
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
