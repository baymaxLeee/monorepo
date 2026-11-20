import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import type { AdditionalPermissionProfile, SandboxPermissions } from "../execution/permissions.js";
import type { CommandOutputStreamMetadata, OrchestratedCommandResult } from "../execution/tool-orchestrator.js";
import { defineAgentTool } from "./manifest.js";
import { toolBlocked, toolCompleted, toolFailed, toolPartial } from "./outcome.js";

export const DEFAULT_BASH_TIMEOUT_MS = 10_000;
export const MAX_BASH_TIMEOUT_MS = 120_000;
export const MAX_BASH_OUTPUT_LINES = 2_000;
export const MAX_BASH_OUTPUT_BYTES = 50 * 1024;

const fileSystemPermissionSchema = z.object({
  path: z.string().min(1).max(4096),
  access: z.enum(["read", "write"]),
});
const additionalPermissionsSchema: z.ZodType<AdditionalPermissionProfile> = z.object({
  fileSystem: z.array(fileSystemPermissionSchema).max(32).optional(),
  network: z
    .object({
      allowedHosts: z
        .array(
          z
            .string()
            .min(1)
            .max(253)
            .regex(/^[a-z0-9.-]+$/iu),
        )
        .max(32),
    })
    .optional(),
});

export const bashInputSchema = z
  .object({
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
    sandbox_permissions: z
      .enum(["use_default", "with_additional_permissions", "require_escalated"])
      .default("use_default") satisfies z.ZodType<SandboxPermissions>,
    additional_permissions: additionalPermissionsSchema
      .optional()
      .describe(
        "Sandboxed filesystem or network access requested for this command; only valid with sandbox_permissions=with_additional_permissions.",
      ),
    retry_of: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe("Retry identity returned by one typed sandbox denial. Omit for a first attempt."),
    justification: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe("User-facing reason for require_escalated; omit for other sandbox permissions."),
    prefix_rule: z
      .array(z.string().min(1).max(256))
      .min(2)
      .max(16)
      .optional()
      .describe("Reusable canonical argv prefix proposed only for require_escalated."),
  })
  .superRefine((value, context) => {
    if (value.sandbox_permissions === "with_additional_permissions" && !value.additional_permissions) {
      context.addIssue({ code: "custom", message: "with_additional_permissions requires additional_permissions" });
    }
    if (value.sandbox_permissions !== "with_additional_permissions" && value.additional_permissions) {
      context.addIssue({ code: "custom", message: "additional_permissions requires with_additional_permissions" });
    }
    if (value.sandbox_permissions !== "require_escalated" && (value.justification || value.prefix_rule)) {
      context.addIssue({ code: "custom", message: "justification and prefix_rule require require_escalated" });
    }
    if (value.retry_of && value.sandbox_permissions === "use_default") {
      context.addIssue({ code: "custom", message: "retry_of requires expanded sandbox permissions" });
    }
  });
export const bashDescription =
  "Execute one bounded Bash command in the authorized workspace for file discovery, validation, CLI or raw-response handling. Prefer read_file, apply_patch, and write_file for ordinary UTF-8 file operations, and direct search/fetch tools for factual public-web questions. Each output stream keeps its last 2000 lines or 50 KiB with explicit omission metadata; if the execution transport retained only a tail, original line counts are reported as unknown. Redirect intentionally needed full logs to a workspace file. Respect the supplied workspace and network capabilities. No host access, service credentials, sudo or unsandboxed fallback.";
export type BashInput = z.infer<typeof bashInputSchema>;
export type BashResult = OrchestratedCommandResult;

export interface BashOutputTruncation {
  truncatedBy: "lines" | "bytes" | "transport";
  totalLines: number | null;
  totalBytes: number;
  outputLines: number;
  outputBytes: number;
  omittedLines: number | null;
  omittedBytes: number;
  partialFirstLine: boolean | null;
  transportTruncated?: true;
}

export type BashVisibleResult = BashResult & {
  truncation?: {
    stdout?: BashOutputTruncation;
    stderr?: BashOutputTruncation;
  };
};

function lines(content: string): string[] {
  if (!content) return [];
  const result = content.split("\n");
  if (content.endsWith("\n")) result.pop();
  return result;
}

function utf8Tail(content: string, maxBytes: number): string {
  const bytes = Buffer.from(content, "utf8");
  let start = Math.max(0, bytes.byteLength - maxBytes);
  while (start < bytes.byteLength && (bytes[start]! & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString("utf8");
}

export function truncateBashStream(
  content: string,
  stream: "stdout" | "stderr",
  options: { maxLines?: number; maxBytes?: number; metadata?: CommandOutputStreamMetadata } = {},
): { content: string; truncation?: BashOutputTruncation } {
  const maxLines = options.maxLines ?? MAX_BASH_OUTPUT_LINES;
  const maxBytes = options.maxBytes ?? MAX_BASH_OUTPUT_BYTES;
  const sourceLines = lines(content);
  const retainedBytes = Buffer.byteLength(content, "utf8");
  const transportTruncated = options.metadata?.truncated === true;
  const totalBytes = Math.max(retainedBytes, options.metadata?.totalBytes ?? retainedBytes);
  const locallyTruncated = sourceLines.length > maxLines || retainedBytes > maxBytes;
  if (!locallyTruncated && !transportTruncated) return { content };

  let tail = content;
  let outputLines = sourceLines.length;
  let outputBytes = retainedBytes;
  let partialFirstLine: boolean | null = transportTruncated ? null : false;
  let truncatedBy: BashOutputTruncation["truncatedBy"] = "transport";
  if (locallyTruncated) {
    const selected: string[] = [];
    let selectedBytes = 0;
    let locallyPartialFirstLine = false;
    truncatedBy = sourceLines.length > maxLines ? "lines" : "bytes";
    for (let index = sourceLines.length - 1; index >= 0 && selected.length < maxLines; index--) {
      const line = sourceLines[index]!;
      const separatorBytes = selected.length > 0 ? 1 : 0;
      const lineBytes = Buffer.byteLength(line, "utf8");
      if (selectedBytes + separatorBytes + lineBytes > maxBytes) {
        truncatedBy = "bytes";
        if (selected.length === 0) {
          const lineTail = utf8Tail(line, maxBytes);
          if (lineTail) {
            selected.unshift(lineTail);
            selectedBytes = Buffer.byteLength(lineTail, "utf8");
            locallyPartialFirstLine = lineTail !== line;
          }
        }
        break;
      }
      selected.unshift(line);
      selectedBytes += separatorBytes + lineBytes;
    }
    if (selected.length === maxLines && sourceLines.length > maxLines && selectedBytes <= maxBytes) {
      truncatedBy = "lines";
    }
    tail = selected.join("\n");
    outputLines = selected.length;
    outputBytes = Buffer.byteLength(tail, "utf8");
    partialFirstLine = locallyPartialFirstLine
      ? true
      : transportTruncated && selected.length === sourceLines.length
        ? null
        : false;
  }

  const totalLines = transportTruncated ? null : sourceLines.length;
  const omittedLines = totalLines === null ? null : Math.max(0, totalLines - outputLines);
  const truncation: BashOutputTruncation = {
    truncatedBy,
    totalLines,
    totalBytes,
    outputLines,
    outputBytes,
    omittedLines,
    omittedBytes: Math.max(0, totalBytes - outputBytes),
    partialFirstLine,
    ...(transportTruncated ? { transportTruncated: true } : {}),
  };
  const window =
    partialFirstLine === true
      ? `showing the last ${outputBytes} bytes of the final line`
      : locallyTruncated
        ? `showing the last ${outputLines} lines`
        : "showing the retained tail";
  const omission = transportTruncated
    ? `transport retained only a tail; omitted ${truncation.omittedBytes} earlier bytes; original line count unknown`
    : `omitted ${truncation.omittedBytes} bytes across ${truncation.omittedLines} complete lines`;
  const notice = `[Earlier ${stream} output truncated: ${omission}; ${window}. Re-run with narrower filters or redirect full output to a workspace file if needed.]`;
  return { content: tail ? `${notice}\n${tail}` : notice, truncation };
}

export function boundBashResult(result: BashResult): BashVisibleResult {
  const stdout = truncateBashStream(result.stdout, "stdout", { metadata: result.outputMetadata?.stdout });
  const stderr = truncateBashStream(result.stderr, "stderr", { metadata: result.outputMetadata?.stderr });
  const truncation = {
    ...(stdout.truncation ? { stdout: stdout.truncation } : {}),
    ...(stderr.truncation ? { stderr: stderr.truncation } : {}),
  };
  return {
    ...result,
    stdout: stdout.content,
    stderr: stderr.content,
    ...(Object.keys(truncation).length > 0 ? { truncation } : {}),
  };
}

export function commandResult(result: BashResult) {
  const visible = boundBashResult(result);
  switch (visible.termination.type) {
    case "exit":
      return visible.termination.exitCode === 0
        ? toolCompleted(visible)
        : toolPartial(visible, {
            code: "COMMAND_FAILED",
            message: `Command exited with code ${visible.termination.exitCode}. Inspect stderr in the result data for command output.`,
            retryable: false,
            source: "bash",
            details: { exit_code: visible.termination.exitCode },
          });
    case "timeout":
      return toolPartial(visible, {
        code: "COMMAND_TIMEOUT",
        message: `Command timed out after ${visible.termination.timeoutMs}ms. Use the evidence already collected and explain what remains incomplete instead of repeating or broadening the command.`,
        retryable: false,
        source: "bash",
        details: { timeout_ms: visible.termination.timeoutMs },
      });
    case "sandbox-violation":
      return toolPartial(visible, {
        code: "SANDBOX_DENIED",
        message: "The sandbox denied the requested authority. Inspect stderr in the result data for command output.",
        retryable: Boolean(visible.termination.retryId),
        source: "bash",
        details: {
          violation: visible.termination.violation,
          ...(visible.termination.retryId ? { retry_of: visible.termination.retryId } : {}),
        },
      });
    case "sandbox-unavailable":
      return toolBlocked({
        code: "SANDBOX_UNAVAILABLE",
        message: visible.termination.message,
        retryable: false,
        source: "bash",
      });
    case "start-error":
      return toolFailed({
        code: "COMMAND_START_FAILED",
        message: visible.termination.message,
        retryable: false,
        source: "bash",
      });
  }
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
