import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { defineAgentTool } from "./manifest.js";
import { toolCompleted, toolPartial } from "./outcome.js";

export const DEFAULT_BASH_TIMEOUT_MS = 10_000;
export const MAX_BASH_TIMEOUT_MS = 120_000;

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
  timeout_ms: z
    .number()
    .int()
    .min(1_000)
    .max(MAX_BASH_TIMEOUT_MS)
    .default(DEFAULT_BASH_TIMEOUT_MS)
    .describe(
      "Command deadline in milliseconds. Defaults to 10000. Increase only for a known bounded command required by the user's goal; never use a longer timeout for open-ended public-data discovery.",
    ),
});
export const bashDescription =
  "Execute one bounded Bash command in the authorized workspace for file discovery, editing, validation, CLI or raw-response handling. Prefer direct search/fetch tools for factual public-web questions; do not turn a simple answer into broad candidate collection or metric aggregation. Respect the supplied workspace and network capabilities. No host access, service credentials, sudo or unsandboxed fallback.";
export type BashInput = z.infer<typeof bashInputSchema>;
export type BashResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  timeoutMs?: number;
};
export function commandResult(result: BashResult) {
  if (result.timedOut) {
    const timeoutMs = result.timeoutMs ?? DEFAULT_BASH_TIMEOUT_MS;
    return toolPartial(result, {
      code: "COMMAND_TIMEOUT",
      message: `Command timed out after ${timeoutMs}ms. Use the evidence already collected and explain what remains incomplete instead of repeating or broadening the command.`,
      retryable: false,
      source: "bash",
      details: { timeout_ms: timeoutMs },
    });
  }
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
      uiKind: "terminal",
    },
    { summary: "Execute CLI programs and manipulate real files in the authorized sandbox." },
  );
}
