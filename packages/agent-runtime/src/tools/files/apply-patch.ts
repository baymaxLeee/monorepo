import { openai } from "@ai-sdk/openai";
import type { ToolExecutionOptions } from "ai";
import { z } from "zod";

import { defineAgentTool } from "../manifest.js";
import { normalizeToolIssue, toolCompleted, toolFailed, toolPartial } from "../outcome.js";
import { parseApplyPatch } from "./patch/parser.js";

const applyPatchGrammar = String.raw`start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`;

const patchInputSchema = z.string().superRefine((input, context) => {
  try {
    parseApplyPatch(input);
  } catch (error) {
    context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid patch" });
  }
});

export interface AppliedFileChange {
  type: "add" | "update" | "delete";
  path: string;
  sha256?: string;
  before_sha256?: string;
}
export interface ApplyPatchResult {
  changes: AppliedFileChange[];
  affected: Array<Pick<AppliedFileChange, "type" | "path">>;
}

export function createApplyPatchTool(
  run: (input: string, options: ToolExecutionOptions<unknown>) => Promise<ApplyPatchResult>,
) {
  return defineAgentTool(
    "apply_patch",
    {
      ...openai.tools.customTool({
        description: "Edit workspace files using a freeform apply_patch instruction.",
        format: { type: "grammar", syntax: "lark", definition: applyPatchGrammar },
        toModelOutput: ({ output }) => ({
          type: "text",
          value: [
            "Success. Updated the following files:",
            ...(["add", "update", "delete"] as const).flatMap((type) =>
              (output as ApplyPatchResult).affected
                .filter((change) => change.type === type)
                .map((change) => `${type === "add" ? "A" : type === "delete" ? "D" : "M"} ${change.path}`),
            ),
            "",
          ].join("\n"),
        }),
        execute: async (input, options) => {
          try {
            const result = await run(input, options);
            return toolCompleted(result);
          } catch (error) {
            const changes =
              error && typeof error === "object" && "changes" in error
                ? (error as { changes: AppliedFileChange[] }).changes
                : [];
            const issue = normalizeToolIssue(error, { source: "apply_patch" });
            return changes.length > 0 ? toolPartial({ changes }, issue) : toolFailed(issue);
          }
        },
      }),
      inputSchema: patchInputSchema,
    },
    { capability: "files", effect: "write", trust: "private-untrusted", execution: "inline" },
    {
      summary: "Apply targeted multi-file text changes with path preflight and partial-commit reporting.",
      prerequisites: ["Read relevant existing files before constructing update or delete actions."],
      constraints: ["Use write_file for a large complete-file replacement."],
    },
  );
}
