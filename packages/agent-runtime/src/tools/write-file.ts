import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { defineAgentTool } from "./manifest.js";
import { toolCompleted } from "./outcome.js";
import { MAX_TEXT_FILE_BYTES } from "./read-file.js";

export const writeFileInputSchema = z
  .object({
    path: z.string().min(1).max(4096).describe("Workspace-relative or absolute destination path."),
    content: z.string().max(MAX_TEXT_FILE_BYTES).describe("Complete UTF-8 file contents."),
    mode: z
      .enum(["create", "overwrite"])
      .describe("create refuses an existing file; overwrite requires expected_sha256."),
    expected_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional()
      .describe("SHA-256 returned by read_file; required for overwrite and forbidden for create."),
  })
  .superRefine((value, context) => {
    if (value.mode === "overwrite" && !value.expected_sha256) {
      context.addIssue({ code: "custom", message: "overwrite requires expected_sha256" });
    }
    if (value.mode === "create" && value.expected_sha256) {
      context.addIssue({ code: "custom", message: "create must not include expected_sha256" });
    }
  });
export type WriteFileInput = z.infer<typeof writeFileInputSchema>;

export interface FileWriteResult {
  path: string;
  sha256: string;
  bytes: number;
  created: boolean;
}

export function createWriteFileTool(
  run: (input: WriteFileInput, options: ToolExecutionOptions<unknown>) => Promise<FileWriteResult>,
) {
  return defineAgentTool(
    "write_file",
    tool({
      description:
        "Create or replace one complete UTF-8 text file without shell escaping. Use create for a new path. For overwrite, first call read_file and pass its exact expected_sha256 so concurrent changes fail instead of being lost.",
      inputSchema: writeFileInputSchema,
      execute: async (input, options) => toolCompleted(await run(input, options)),
    }),
    { capability: "files", effect: "write", trust: "private-untrusted", execution: "inline" },
    {
      summary: "Safely create or replace a complete UTF-8 file.",
      prerequisites: ["Read an existing file first and reuse its SHA-256 when overwriting."],
      constraints: ["Use apply_patch for localized edits and bash for generated binary output."],
    },
  );
}
