import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { defineAgentTool } from "./manifest.js";
import { toolCompleted, toolPartial } from "./outcome.js";

export const bashInputSchema = z.object({
  command: z
    .string()
    .min(1)
    .max(65536)
    .describe("Bash command or script. Prefer explicit paths and quoted heredocs for file content."),
  workdir: z
    .string()
    .optional()
    .describe("Existing workspace directory. Omit to use the authorized working directory."),
});
export const bashDescription =
  "Execute Bash in the authorized sandbox for file discovery, read/create/edit/delete, CLI and program execution. Do not use Bash for ordinary public web discovery or page reading when search/fetch tools are available. Respect the supplied workspace and network capabilities. No host access, service credentials, sudo or unsandboxed fallback.";
export type BashInput = z.infer<typeof bashInputSchema>;
export type BashResult = { exitCode: number; stdout: string; stderr: string };
export function commandResult(result: BashResult) {
  return result.exitCode === 0
    ? toolCompleted(result)
    : toolPartial(result, {
        code: "COMMAND_FAILED",
        message: result.stderr || `Command exited with code ${result.exitCode}`,
        retryable: false,
        source: "bash",
      });
}
export function createBashTool(run: (input: BashInput, options: ToolExecutionOptions<unknown>) => Promise<BashResult>) {
  return defineAgentTool(
    "bash",
    tool({
      description: bashDescription,
      inputSchema: bashInputSchema,
      execute: async (input, options) => commandResult(await run(input, options)),
    }),
    {
      capability: "files",
      effect: "write",
      trust: "private-untrusted",
      execution: "inline",
      modes: ["normal", "plan"],
      uiKind: "terminal",
    },
    { summary: "Execute CLI programs and manipulate real files in the authorized sandbox." },
  );
}
