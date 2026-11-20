import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { defineAgentTool } from "./manifest.js";
import { toolCompleted } from "./outcome.js";

export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
export const DEFAULT_READ_MAX_LINES = 2_000;
export const DEFAULT_READ_MAX_BYTES = 50 * 1024;

export const readFileInputSchema = z.object({
  path: z.string().min(1).max(4096).describe("Workspace-relative or absolute path to one UTF-8 text file."),
  offset: z.number().int().min(1).optional().describe("1-based first line to return."),
  limit: z.number().int().min(1).max(DEFAULT_READ_MAX_LINES).optional().describe("Maximum complete lines to return."),
});
export type ReadFileInput = z.infer<typeof readFileInputSchema>;

export interface TextFileSnapshot {
  content: string;
  sha256: string;
  bytes: number;
}

export interface SelectedFileLines {
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
  truncatedBy: "lines" | "bytes" | null;
  nextOffset?: number;
  notice?: string;
}

export function selectFileLines(
  content: string,
  options: { offset?: number; limit?: number; maxBytes?: number } = {},
): SelectedFileLines {
  const lines = content.split("\n");
  const startLine = options.offset ?? 1;
  if (startLine > lines.length)
    throw new RangeError(`Offset ${startLine} is beyond end of file (${lines.length} lines total)`);
  const maxLines = options.limit ?? DEFAULT_READ_MAX_LINES;
  const maxBytes = options.maxBytes ?? DEFAULT_READ_MAX_BYTES;
  const selected: string[] = [];
  let outputBytes = 0;
  let truncatedBy: SelectedFileLines["truncatedBy"] = null;
  const availableEnd = Math.min(lines.length, startLine - 1 + maxLines);
  for (let index = startLine - 1; index < availableEnd; index++) {
    const line = lines[index]!;
    const bytes = Buffer.byteLength(line, "utf8") + (selected.length > 0 ? 1 : 0);
    if (outputBytes + bytes > maxBytes) {
      truncatedBy = "bytes";
      break;
    }
    selected.push(line);
    outputBytes += bytes;
  }
  if (truncatedBy === null && startLine - 1 + selected.length < lines.length) truncatedBy = "lines";
  const endLine = startLine + Math.max(0, selected.length - 1);
  const truncated = truncatedBy !== null;
  const nextOffset = truncated && selected.length > 0 ? endLine + 1 : undefined;
  const notice =
    truncatedBy === "bytes" && selected.length === 0
      ? `Line ${startLine} exceeds the ${maxBytes}-byte read limit; use bash with a bounded byte range.`
      : truncated
        ? `Showing lines ${startLine}-${endLine} of ${lines.length}; continue with offset=${nextOffset}.`
        : undefined;
  return {
    content: selected.join("\n"),
    startLine,
    endLine,
    totalLines: lines.length,
    truncated,
    truncatedBy,
    ...(nextOffset ? { nextOffset } : {}),
    ...(notice ? { notice } : {}),
  };
}

export function createReadFileTool(
  run: (input: ReadFileInput, options: ToolExecutionOptions<unknown>) => Promise<TextFileSnapshot & { path: string }>,
) {
  return defineAgentTool(
    "read_file",
    tool({
      description:
        "Read one UTF-8 text file directly without shell quoting. Returns a SHA-256 content identity and bounded complete lines; continue large files with offset. Use bash for directory discovery, binary files, or byte-oriented processing.",
      inputSchema: readFileInputSchema,
      execute: async (input, options) => {
        const snapshot = await run(input, options);
        return toolCompleted({
          path: snapshot.path,
          sha256: snapshot.sha256,
          bytes: snapshot.bytes,
          ...selectFileLines(snapshot.content, input),
        });
      },
    }),
    { capability: "files", effect: "read", trust: "private-untrusted", execution: "inline" },
    {
      summary: "Read bounded UTF-8 file contents with a stable content identity.",
      constraints: ["Use bash instead for directory discovery and non-text or oversized files."],
      parallelizable: true,
    },
  );
}
