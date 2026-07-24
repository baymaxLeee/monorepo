import { tool } from "ai";
import { z } from "zod";
import type { ChatProvider } from "@backend/transport-ts/provider-model";

import type { AgentMode } from "../../agents/types.js";
import {
  listVirtualFiles,
  readVirtualFile,
  searchVirtualFiles,
} from "../../../../infrastructure/clients/knowledge.js";
import { fileToolContextSchema, type FileToolContext } from "../context.js";
import { defineAgentTool } from "../manifest.js";
import type { ToolEmission } from "../outcome.js";
import { createFileWriteToolManifests } from "./file-writes.js";

const listFilesOutputSchema = z.object({
  files: z.array(
    z.object({
      path: z.string(),
      title: z.string(),
      filename: z.string(),
      kind: z.string(),
      mime_type: z.string(),
      size: z.number().nullable(),
      status: z.string(),
      updated_at: z.string(),
      writable: z.boolean(),
      derived: z.boolean(),
    }),
  ),
});

const readFileOutputSchema = z.object({
  path: z.string(),
  title: z.string(),
  filename: z.string(),
  mime_type: z.string(),
  offset: z.number(),
  total_lines: z.number(),
  next_offset: z.number().nullable(),
  sha256: z.string(),
  content: z.string(),
  untrusted: z.boolean(),
});

const searchFilesOutputSchema = z.object({
  matches: z.array(z.object({ path: z.string(), line: z.number(), column: z.number(), text: z.string() })),
  truncated: z.boolean(),
});

async function listFiles(
  input: { path?: string },
  { context }: { context: FileToolContext },
) {
  const rows = await listVirtualFiles(context.userId, context.conversationId, input.path);
  return {
    files: rows
      .filter((row) => !input.path || row.path.startsWith(`${input.path.replace(/\/+$/, "")}/`))
      .map((row) => ({
      path: row.path,
      title: row.path.split("/").at(-1) ?? row.path,
      filename: row.path,
      kind: row.derived ? "derived" : "text",
      mime_type: row.mime_type,
      size: row.size,
      status: row.writable ? "ready" : "readonly",
      updated_at: "",
      writable: row.writable,
      derived: row.derived,
    })),
  };
}

async function readFile(
  input: { path: string; offset: number; limit: number },
  { context }: { context: FileToolContext },
): Promise<z.infer<typeof readFileOutputSchema> | ToolEmission> {
  const slice = await readVirtualFile({
    userId: context.userId,
    conversationId: context.conversationId,
    path: input.path,
    offset: input.offset,
    limit: input.limit,
  });
  return {
    path: slice.path,
    title: slice.path.split("/").at(-1) ?? slice.path,
    filename: slice.path,
    mime_type: slice.mime_type,
    offset: slice.offset,
    total_lines: slice.total_lines,
    next_offset: slice.next_offset,
    sha256: slice.sha256,
    content: slice.content,
    untrusted: input.path.startsWith("sources/"),
  };
}

async function searchFiles(
  input: { pattern: string; path?: string; glob?: string },
  { context }: { context: FileToolContext },
): Promise<z.infer<typeof searchFilesOutputSchema>> {
  const matches = await searchVirtualFiles({
    userId: context.userId,
    conversationId: context.conversationId,
    pattern: input.pattern,
    path: input.path,
    glob: input.glob,
  });
  return { matches, truncated: matches.length >= 200 };
}

export function createFileToolManifests(
  mode: AgentMode,
  textProvider: ChatProvider,
) {
  return [
    defineAgentTool(
      "list_files",
      tool({
        description: "List files attached to the current conversation, including generated artifacts.",
        inputSchema: z.object({
          path: z.string().min(1).max(512).optional(),
        }),
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
          path: z.string().min(1).max(512),
          offset: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(400).default(200),
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
    defineAgentTool(
      "search_files",
      tool({
        description: "Search attached text files with a bounded regular expression scan.",
        inputSchema: z.object({
          pattern: z.string().min(1).max(500),
          path: z.string().min(1).max(512).optional(),
          glob: z.string().max(120).optional(),
        }),
        outputSchema: searchFilesOutputSchema,
        contextSchema: fileToolContextSchema,
        execute: searchFiles,
      }),
      {
        capability: "files",
        effect: "read",
        trust: "private-untrusted",
        execution: "inline",
        modes: ["normal", "plan"],
      },
      { summary: "Search attached text files by regular expression." },
    ),
    ...createFileWriteToolManifests(mode, textProvider),
  ];
}
