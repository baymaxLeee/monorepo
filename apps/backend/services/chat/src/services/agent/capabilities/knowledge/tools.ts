import { tool } from "ai";
import { z } from "zod";

import {
  getDocument,
  getDocumentSlice,
  getDocumentSource,
  listDocuments,
} from "../../../../clients/knowledge.js";
import { toolContextSchema, type ToolContext } from "../../contract.js";

async function listFiles(_input: {}, { context }: { context: ToolContext }) {
  try {
    const rows = await listDocuments(context.userId, context.conversationId);
    return {
      ok: true,
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
  } catch (error) {
    return { ok: false, error: `failed to list files: ${String(error).slice(0, 500)}` };
  }
}

async function readFile(
  input: { file_id: string; offset: number; max_chars: number },
  { context }: { context: ToolContext },
) {
  try {
    const document = await getDocument(context.userId, input.file_id);
    if (document.conversation_id !== context.conversationId) {
      return { ok: false, error: `file ${input.file_id} is not attached to this conversation` };
    }
    if (document.content_md) {
      const slice = await getDocumentSlice(
        context.userId,
        input.file_id,
        input.offset,
        input.max_chars,
      );
      return {
        ok: true,
        file_id: document.id,
        title: document.title,
        filename: document.filename,
        mime_type: document.mime_type,
        offset: slice.start,
        total_chars: slice.total_chars,
        next_offset: slice.next_start,
        content: slice.content,
        untrusted: document.kind === "source",
      };
    }
    const source = await getDocumentSource(context.userId, input.file_id);
    const text = new TextDecoder().decode(source.bytes);
    const content = text.slice(input.offset, input.offset + input.max_chars);
    const next = input.offset + content.length;
    return {
      ok: true,
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
  } catch (error) {
    return { ok: false, error: String(error).slice(0, 500) };
  }
}

export function createKnowledgeTools() {
  return {
    list_files: tool({
      description: "List files attached to the current conversation, including generated artifacts.",
      inputSchema: z.object({}),
      contextSchema: toolContextSchema,
      execute: listFiles,
    }),
    read_file: tool({
      description:
        "Read a bounded slice of a conversation file. Continue with next_offset for large files.",
      inputSchema: z.object({
        file_id: z.string().min(1).max(32),
        offset: z.number().int().min(0).default(0),
        max_chars: z.number().int().min(1).max(20_000).default(8_000),
      }),
      contextSchema: toolContextSchema,
      execute: readFile,
    }),
  };
}

