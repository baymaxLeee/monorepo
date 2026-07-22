import { tool } from "ai";
import { z } from "zod";
import type { ChatProvider } from "@backend/transport-ts/provider-model";

import type { AgentMode } from "../../agents/types.js";
import {
  getDocument,
  getDocumentSource,
  getDocumentSlice,
  listDocuments,
} from "../../../../infrastructure/clients/knowledge.js";
import { fileToolContextSchema, type FileToolContext } from "../context.js";
import { defineAgentTool } from "../manifest.js";
import { toolBlocked, ToolBlockedError, type ToolEmission } from "../outcome.js";
import { createFileWriteToolManifests } from "./file-writes.js";

const listFilesOutputSchema = z.object({
  files: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      filename: z.string(),
      kind: z.string(),
      mime_type: z.string(),
      size: z.number().nullable(),
      status: z.string(),
      updated_at: z.string(),
    }),
  ),
});

const readFileOutputSchema = z.object({
  file_id: z.string(),
  title: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  offset: z.number(),
  total_chars: z.number(),
  next_offset: z.number().nullable(),
  content: z.string(),
  untrusted: z.boolean(),
});

// The document is referenceable at upload (ingest_status="received"); the heavy
// MarkItDown/vision convert then runs in the background. When the model reads a
// just-uploaded file we long-poll the slice endpoint for this long so a single
// tool call returns the content once convert finishes, instead of the model
// having to give up and retry.
const READ_FILE_CONVERT_WAIT_MS = 60_000;

async function listFiles(_input: {}, { context }: { context: FileToolContext }) {
  const rows = await listDocuments(context.userId, context.conversationId);
  return {
    files: rows.map((row) => ({
      id: row.id,
      title: row.title,
      filename: row.filename,
      kind: row.kind,
      mime_type: row.mime_type,
      size: row.source_size,
      status: row.ingest_status,
      updated_at: row.updated_at,
    })),
  };
}

async function readFile(
  input: { file_id: string; offset: number; max_chars: number },
  { context }: { context: FileToolContext },
): Promise<z.infer<typeof readFileOutputSchema> | ToolEmission> {
  const document = await getDocument(context.userId, input.file_id);
  if (document.conversation_id !== context.conversationId) {
    throw new ToolBlockedError({
      code: "FILE_NOT_ATTACHED",
      message: `file ${input.file_id} is not attached to this conversation`,
      retryable: false,
      source: "knowledge",
      details: { file_id: input.file_id },
    });
  }
  if (
    document.kind === "artifact" &&
    document.object_key &&
    document.mime_type.startsWith("text/")
  ) {
    const source = await getDocumentSource(context.userId, input.file_id);
    const content = new TextDecoder().decode(source.bytes);
    const chunk = content.slice(input.offset, input.offset + input.max_chars);
    const nextOffset =
      input.offset + chunk.length < content.length
        ? input.offset + chunk.length
        : null;
    return {
      file_id: document.id,
      title: document.title,
      filename: document.filename,
      mime_type: source.mimeType,
      offset: input.offset,
      total_chars: content.length,
      next_offset: nextOffset,
      content: chunk,
      untrusted: false,
    };
  }
  const alreadyConverted = Boolean(document.content_md) || document.ingest_status === "ready";
  const slice = await getDocumentSlice(
    context.userId,
    input.file_id,
    input.offset,
    input.max_chars,
    alreadyConverted ? 0 : READ_FILE_CONVERT_WAIT_MS,
  );
  if (slice.state === "processing") {
    return toolBlocked({
      code: "FILE_PROCESSING",
      message:
        "file received but still being processed (converting); tell the user it is not readable yet and retry read_file shortly",
      retryable: true,
      source: "knowledge",
      details: { file_id: document.id, filename: document.filename },
    });
  }
  if (slice.state === "failed") {
    throw Object.assign(new Error(slice.error ?? "file conversion failed"), {
      code: "FILE_CONVERSION_FAILED",
      details: { file_id: document.id, filename: document.filename },
    });
  }
  return {
    file_id: document.id,
    title: slice.title,
    filename: slice.filename,
    mime_type: slice.mime_type,
    offset: slice.start,
    total_chars: slice.total_chars,
    next_offset: slice.next_start ?? null,
    content: slice.content,
    untrusted: document.kind === "source",
  };
}

export function createFileToolManifests(mode: AgentMode, textProvider: ChatProvider) {
  return [
    defineAgentTool(
      "list_files",
      tool({
        description: "List files attached to the current conversation, including generated artifacts.",
        inputSchema: z.object({}),
        outputSchema: listFilesOutputSchema,
        contextSchema: fileToolContextSchema,
        execute: listFiles,
      }),
      {
        capability: "files",
        effect: "read",
        trust: "private-untrusted",
        execution: "inline",
        modes: ["normal", "plan"],
      },
      { summary: "List source files and generated artifacts attached to the conversation." },
    ),
    defineAgentTool(
      "read_file",
      tool({
        description: "Read a bounded slice of a conversation file. Continue from next_offset when present.",
        inputSchema: z.object({
          file_id: z.string().min(1).max(32),
          offset: z.number().int().min(0).default(0),
          max_chars: z
            .number()
            .int()
            .min(1)
            .default(8_000)
            .transform((value) => Math.min(value, 8_000))
            .describe("Maximum characters to return; values above 8000 are clamped."),
        }),
        outputSchema: readFileOutputSchema,
        contextSchema: fileToolContextSchema,
        execute: readFile,
      }),
      {
        capability: "files",
        effect: "read",
        trust: "private-untrusted",
        execution: "inline",
        modes: ["normal", "plan"],
      },
      { summary: "Read bounded slices of a conversation file." },
    ),
    ...createFileWriteToolManifests(mode, textProvider),
  ];
}
