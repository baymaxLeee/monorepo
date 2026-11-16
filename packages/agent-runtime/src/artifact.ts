import { tool, type ToolExecutionOptions, type UIMessageChunk } from "ai";
import { z } from "zod";

import { defineAgentTool } from "./manifest.js";
import { toolOutcomeData } from "./outcome.js";

export const uploadArtifactInputSchema = z.object({
  operation: z.enum(["create", "update"]),
  path: z.string().min(1).describe("Completed file path in the authorized writable workspace."),
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
});

export const uploadArtifactsInputSchema = z.object({ artifacts: z.array(uploadArtifactInputSchema).min(1) });
export type UploadArtifactInput = z.infer<typeof uploadArtifactInputSchema>;
export type UploadArtifactsInput = z.infer<typeof uploadArtifactsInputSchema>;
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

export interface UploadedArtifacts {
  files: PublishedWorkspaceFile[];
}

function validatedArtifact(input: UploadArtifactInput) {
  if (input.operation === "create") {
    if (!input.filename || !input.media_type || !input.title || input.file_id !== null || input.etag !== null) {
      throw new Error("Create requires filename, media_type and title; file_id and etag must be null.");
    }
    return {
      operation: "create" as const,
      path: input.path,
      filename: input.filename,
      media_type: input.media_type,
      title: input.title,
    };
  }
  if (!input.file_id || !input.etag || input.filename !== null || input.media_type !== null || input.title !== null) {
    throw new Error("Update requires file_id and etag; filename, media_type and title must be null.");
  }
  return { operation: "update" as const, path: input.path, file_id: input.file_id, etag: input.etag };
}

export function createUploadArtifactsTool<CONTEXT extends Record<string, unknown> = Record<string, unknown>>(
  publish: (
    input:
      | { operation: "create"; path: string; filename: string; media_type: string; title: string }
      | { operation: "update"; path: string; file_id: string; etag: string },
    options: ToolExecutionOptions<CONTEXT>,
  ) => Promise<PublishedWorkspaceFile>,
  options: { contextSchema?: z.ZodType<CONTEXT> } = {},
) {
  return defineAgentTool(
    "upload_artifacts",
    tool<UploadArtifactsInput, UploadedArtifacts, CONTEXT>({
      description:
        "Upload one or more completed cloud workspace files into the conversation as durable inline deliverables. Submit every completed file in one batch. Use operation=create for a newly published file. Use update with the restored file_id and ETag after editing a previously published file. Never turn a conflict into create automatically.",
      inputSchema: uploadArtifactsInputSchema,
      ...(options.contextSchema ? { contextSchema: options.contextSchema } : {}),
      execute: async (input, execution) => {
        const artifacts = input.artifacts.map(validatedArtifact);
        const files = await Promise.all(
          artifacts.map((artifact, index) =>
            publish(artifact, { ...execution, toolCallId: `${execution.toolCallId}:${index}` }),
          ),
        );
        return { files };
      },
    }),
    {
      capability: "files",
      effect: "add",
      trust: "closed",
      execution: "inline",
      modes: ["normal", "plan"],
      uiKind: "artifact",
    },
    { summary: "Upload completed cloud workspace files as inline conversation files, preserving updates with CAS." },
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
