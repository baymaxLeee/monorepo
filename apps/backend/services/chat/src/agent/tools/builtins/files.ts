import { tool } from "ai";
import { z } from "zod";

import {
  getDocument,
  getDocumentSlice,
  getDocumentSource,
  listDocuments,
} from "../../../clients/knowledge.js";
import { fileToolContextSchema, type FileToolContext } from "../context.js";
import { defineAgentTool } from "../manifest.js";

const listFilesOutputSchema = z.object({
  status: z.literal("completed"),
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

const readFileOutputSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("completed"),
    file_id: z.string(),
    title: z.string(),
    filename: z.string(),
    mime_type: z.string(),
    offset: z.number(),
    total_chars: z.number(),
    next_offset: z.number().nullable(),
    content: z.string(),
    untrusted: z.boolean(),
  }),
  z.object({
    status: z.literal("blocked"),
    code: z.literal("FILE_NOT_ATTACHED"),
    message: z.string(),
  }),
]);

async function listFiles(_input: {}, { context }: { context: FileToolContext }) {
  const rows = await listDocuments(context.userId, context.conversationId);
  return {
    status: "completed" as const,
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
): Promise<z.infer<typeof readFileOutputSchema>> {
  const document = await getDocument(context.userId, input.file_id);
  if (document.conversation_id !== context.conversationId) {
    return {
      status: "blocked" as const,
      code: "FILE_NOT_ATTACHED" as const,
      message: `file ${input.file_id} is not attached to this conversation`,
    };
  }
  if (document.content_md) {
    const slice = await getDocumentSlice(
      context.userId,
      input.file_id,
      input.offset,
      input.max_chars,
    );
    return {
      status: "completed" as const,
      file_id: document.id,
      title: document.title,
      filename: document.filename,
      mime_type: document.mime_type,
      offset: slice.start,
      total_chars: slice.total_chars,
      next_offset: slice.next_start ?? null,
      content: slice.content,
      untrusted: document.kind === "source",
    };
  }
  const source = await getDocumentSource(context.userId, input.file_id);
  const text = new TextDecoder().decode(source.bytes);
  const content = text.slice(input.offset, input.offset + input.max_chars);
  const next = input.offset + content.length;
  return {
    status: "completed" as const,
    file_id: document.id,
    title: document.title,
    filename: document.filename,
    mime_type: source.mimeType,
    offset: input.offset,
    total_chars: text.length,
    next_offset: next < text.length ? next : null,
    content,
    untrusted: document.kind === "source",
  };
}

export function createFileToolManifests() {
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
          max_chars: z.number().int().min(1).max(20_000).default(8_000),
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
  ];
}
