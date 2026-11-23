import { tool, type ToolExecutionOptions } from "ai";
import { z } from "zod";

import { defineAgentTool } from "../tools/manifest.js";
import { toolBlocked, toolFailed, toolPartial } from "../tools/outcome.js";
import type { CommandSessions, ExecCommandOutput, ProcessIO } from "./command-sessions.js";
import type { OrchestratedCommandResult } from "./orchestrator.js";
import type { AdditionalPermissionProfile } from "./permissions.js";

const paths = z.array(z.string().min(1));
const additionalPermissionsSchema: z.ZodType<AdditionalPermissionProfile> = z.strictObject({
  file_system: z.strictObject({ read: paths.optional(), write: paths.optional() }).optional(),
  network: z.strictObject({ enabled: z.boolean().optional() }).optional(),
});

export const bashArgs = z
  .strictObject({
    command: z.string().min(1).optional(),
    session_id: z.number().int().positive().optional(),
    stdin: z.string().optional(),
    workdir: z.string().optional(),
    shell: z.string().optional(),
    login: z.boolean().optional(),
    tty: z.boolean().optional(),
    yield_time_ms: z.number().int().nonnegative().optional(),
    max_output_tokens: z.number().int().nonnegative().optional(),
    sandbox_permissions: z.enum(["use_default", "with_additional_permissions", "require_escalated"]).optional(),
    additional_permissions: additionalPermissionsSchema.optional(),
    justification: z.string().optional(),
    prefix_rule: z.array(z.string()).optional(),
    retry_of: z.string().optional(),
  })
  .superRefine((input, context) => {
    const startsCommand = input.command !== undefined;
    const continuesSession = input.session_id !== undefined;
    if (startsCommand === continuesSession) {
      context.addIssue({ code: "custom", message: "provide exactly one of command or session_id" });
      return;
    }
    if (startsCommand && input.stdin !== undefined) {
      context.addIssue({ code: "custom", path: ["stdin"], message: "stdin requires session_id" });
    }
    if (continuesSession) {
      for (const field of [
        "workdir",
        "shell",
        "login",
        "tty",
        "sandbox_permissions",
        "additional_permissions",
        "justification",
        "prefix_rule",
        "retry_of",
      ] as const) {
        if (input[field] !== undefined) {
          context.addIssue({ code: "custom", path: [field], message: `${field} applies only when starting a command` });
        }
      }
    }
  });

export type BashArgs = z.infer<typeof bashArgs>;
export type BashCommandArgs = BashArgs & { command: string; session_id?: undefined; stdin?: undefined };

function bashCommandInput(input: BashArgs): BashCommandArgs {
  if (!input.command || input.session_id !== undefined) throw new Error("bash command input is required");
  return input as BashCommandArgs;
}

export function commandForPolicy(input: BashArgs) {
  const command = bashCommandInput(input);
  if (command.shell && !["/bin/bash", "/bin/sh", "/bin/zsh"].includes(command.shell)) {
    throw new Error("Unsupported shell");
  }
  if (Boolean(command.additional_permissions) !== (command.sandbox_permissions === "with_additional_permissions")) {
    throw new Error("additional_permissions requires with_additional_permissions");
  }
  if ((command.justification || command.prefix_rule) && command.sandbox_permissions !== "require_escalated") {
    throw new Error("justification and prefix_rule require require_escalated");
  }
  return {
    ...command,
    sandbox_permissions: command.sandbox_permissions ?? "use_default",
    timeout_ms: 1_800_000,
  };
}

function response(result: Awaited<ReturnType<CommandSessions["start"]>>) {
  const { output, termination } = result;
  if (!termination || termination.type === "exit") return output;
  if (termination.type === "sandbox-violation")
    return toolPartial(
      { ...output, termination },
      {
        code: "SANDBOX_DENIED",
        source: "bash",
        message: "Sandbox denied command execution",
        retryable: Boolean(termination.retryId),
        details: { violation: termination.violation, retry_of: termination.retryId ?? null },
      },
    );
  if (termination.type === "sandbox-unavailable")
    return toolBlocked({ code: "SANDBOX_UNAVAILABLE", message: termination.message, retryable: false });
  if (termination.type === "start-error")
    return toolFailed({ code: "COMMAND_START_FAILED", message: termination.message, retryable: false });
  return toolPartial(output, {
    code: "COMMAND_TIMEOUT",
    message: `Command timed out after ${termination.timeoutMs}ms`,
    retryable: false,
  });
}

export function formatExecOutput(data: ExecCommandOutput) {
  return [
    `Chunk ID: ${data.chunk_id}`,
    `Wall time: ${data.wall_time_seconds.toFixed(4)} seconds`,
    ...(data.session_id === undefined
      ? [`Process exited with code ${data.exit_code}`]
      : [`Process running with session ID ${data.session_id}`]),
    `Original token count: ${data.original_token_count}`,
    "Output:",
    data.output,
    ...(data.full_output
      ? [`[Full output: ${data.full_output.path} (read it with Bash using byte offsets/limits)]`]
      : []),
  ].join("\n");
}

export function createBashTool(
  sessions: CommandSessions,
  launch: (
    input: BashCommandArgs,
    io: ProcessIO,
    options: ToolExecutionOptions<unknown>,
  ) => Promise<OrchestratedCommandResult>,
) {
  const policy = {
    capability: "files",
    effect: "write",
    trust: "private-untrusted",
    execution: "inline",
    uiKind: "terminal",
  } as const;
  // The shared manifest unwraps successful tool data before calling toModelOutput.
  const toModelOutput = ({ output }: { output: unknown }) => ({
    type: "text" as const,
    value: formatExecOutput(output as ExecCommandOutput),
  });
  return defineAgentTool(
    "bash",
    tool({
      description:
        "Run a Bash command in the authorized workspace. If it returns a session_id, call bash again with that session_id and optional stdin to interact with or poll the same process. Truncated output includes a host-owned full-output path that can be read with ordinary Bash tools.",
      inputSchema: bashArgs,
      toModelOutput,
      execute: async (input, options) =>
        response(
          input.session_id !== undefined
            ? await sessions.write(
                input.session_id,
                input.stdin ?? "",
                options.toolCallId,
                input.yield_time_ms ?? 1000,
                input.max_output_tokens ?? 10000,
              )
            : await sessions.start(
                {
                  tty: input.tty ?? false,
                  reviewInput:
                    input.sandbox_permissions === "require_escalated" ||
                    input.sandbox_permissions === "with_additional_permissions" ||
                    Boolean(input.shell || input.login),
                  yieldMs: input.yield_time_ms ?? 10_000,
                  tokens: input.max_output_tokens ?? 10000,
                },
                (io) => launch(bashCommandInput(input), io, options),
              ),
        ),
    }),
    policy,
    { summary: "Run Bash and continue retained terminal sessions through one tool." },
  );
}
