import { tool, type ToolExecutionOptions, type UIMessageChunk } from "ai";
import { z } from "zod";

import { defineAgentTool } from "./manifest.js";
import {
  normalizeToolIssue,
  shouldRethrowToolError,
  toolCompleted,
  toolOutcomeData,
  toolPartial,
  type ToolEmission,
} from "./outcome.js";

export interface PublishedWorkspaceFile {
  file_id: string;
  filename: string;
  title: string;
  media_type: string;
  kind: string;
  etag: string;
  updated: boolean;
  workspace_path?: string;
}

export type ArtifactPublicationOptions<CONTEXT extends Record<string, unknown>> = ToolExecutionOptions<CONTEXT> & {
  artifactIndex: number;
};

export interface UploadedArtifacts {
  files: PublishedWorkspaceFile[];
}

export function workspaceMediaType(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase();
  return (
    {
      css: "text/css",
      csv: "text/csv",
      html: "text/html",
      js: "text/javascript",
      json: "application/json",
      jsx: "text/jsx",
      md: "text/markdown",
      mjs: "text/javascript",
      py: "text/x-python",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      zip: "application/zip",
      pdf: "application/pdf",
      png: "image/png",
      svg: "image/svg+xml",
      ts: "text/typescript",
      tsx: "text/tsx",
      txt: "text/plain",
      webp: "image/webp",
      yaml: "application/yaml",
      yml: "application/yaml",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

const uploadArtifactsInputSchema = z.object({
  paths: z
    .array(z.string().min(1))
    .min(1)
    .describe("Completed deliverable paths, absolute or relative to the default Bash working directory."),
});
type UploadArtifactsInput = z.infer<typeof uploadArtifactsInputSchema>;

export function createUploadArtifactsTool<CONTEXT extends Record<string, unknown> = Record<string, unknown>>(
  publish: (path: string, options: ArtifactPublicationOptions<CONTEXT>) => Promise<PublishedWorkspaceFile>,
  options: { contextSchema?: z.ZodType<CONTEXT> } = {},
) {
  return defineAgentTool(
    "upload_artifacts",
    tool<UploadArtifactsInput, ToolEmission<UploadedArtifacts>, CONTEXT>({
      description:
        "Present completed workspace files in the conversation. Submit their paths in a single batch. Include only requested deliverables; leave drafts and intermediate files in the workspace.",
      inputSchema: uploadArtifactsInputSchema,
      ...(options.contextSchema ? { contextSchema: options.contextSchema } : {}),
      execute: async (input, execution) => {
        const paths = [...new Set(input.paths)];
        const files: PublishedWorkspaceFile[] = [];
        for (const [index, path] of paths.entries()) {
          try {
            execution.abortSignal?.throwIfAborted();
            files.push(await publish(path, { ...execution, artifactIndex: index }));
          } catch (error) {
            if (!files.length || shouldRethrowToolError(error, execution.abortSignal)) throw error;
            return toolPartial({ files }, normalizeToolIssue(error, { details: { failedPath: path } }));
          }
        }
        return toolCompleted({ files });
      },
    }),
    {
      capability: "files",
      effect: "add",
      trust: "closed",
      execution: "inline",
      uiKind: "artifact",
    },
    { summary: "Present selected workspace files as inline deliverables." },
  );
}

function publishedWorkspaceFile(value: unknown): PublishedWorkspaceFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item.file_id !== "string" ||
    item.file_id.length !== 32 ||
    typeof item.filename !== "string" ||
    typeof item.title !== "string" ||
    typeof item.media_type !== "string" ||
    typeof item.kind !== "string" ||
    typeof item.etag !== "string" ||
    typeof item.updated !== "boolean"
  ) {
    return null;
  }
  return {
    file_id: item.file_id,
    filename: item.filename,
    title: item.title,
    media_type: item.media_type,
    kind: item.kind,
    etag: item.etag,
    updated: item.updated,
    ...(typeof item.workspace_path === "string" ? { workspace_path: item.workspace_path } : {}),
  };
}

/** Project the trusted terminal tool result into an ordered, persistent UI data part. */
export function fileDataChunks(chunk: UIMessageChunk): UIMessageChunk[] {
  if (chunk.type !== "tool-output-available" || chunk.preliminary) return [];
  const agent = chunk.toolMetadata?.agent;
  if (
    !agent ||
    typeof agent !== "object" ||
    Array.isArray(agent) ||
    (agent as Record<string, unknown>).uiKind !== "artifact"
  ) {
    return [];
  }
  const outcome = toolOutcomeData(chunk.output);
  if (!outcome || typeof outcome !== "object" || Array.isArray(outcome)) return [];
  const files = (outcome as Record<string, unknown>).files;
  if (!Array.isArray(files)) return [];
  return files.flatMap((value) => {
    const data = publishedWorkspaceFile(value);
    return data ? ([{ type: "data-file", id: data.file_id, data } as UIMessageChunk] as UIMessageChunk[]) : [];
  });
}
