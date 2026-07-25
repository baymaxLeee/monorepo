import type { JSONObject, JSONValue } from "@ai-sdk/provider";
import type { ToolResultOutput } from "@ai-sdk/provider-utils";
import type { ToolSet } from "ai";
import { z } from "zod";

import type {
  AgentToolManifest,
  AgentToolPlanning,
  AgentToolPolicy,
  ToolAvailability,
} from "./types.js";
import {
  isToolEmission,
  normalizeToolIssue,
  outcomeFromEmission,
  shouldRethrowToolError,
  toolFailed,
  toolBlocked,
  toolOutcomeSchema,
  ToolBlockedError,
  type ToolOutcome,
} from "./outcome.js";

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value &&
      (typeof value === "object" || typeof value === "function") &&
      Symbol.asyncIterator in value,
  );
}

function caughtErrorOutcome(error: unknown, toolCallId?: string): ToolOutcome {
  return outcomeFromEmission(
    error instanceof ToolBlockedError
      ? toolBlocked(error.issue)
      : toolFailed(
          normalizeToolIssue(error, {
            ...(toolCallId ? { details: { tool_call_id: toolCallId } } : {}),
          }),
        ),
  );
}

async function* wrapAsyncToolResult(
  iterable: AsyncIterable<unknown>,
  options: { abortSignal?: AbortSignal; toolCallId?: string },
): AsyncGenerator<ToolOutcome> {
  try {
    for await (const value of iterable) {
      if (!isToolEmission(value)) {
        yield outcomeFromEmission(
          toolFailed({
            code: "INTERNAL_TOOL_PROTOCOL_ERROR",
            message: "streaming tool yielded a value without an explicit ToolEmission",
            retryable: false,
            source: "chat",
          }),
        );
        return;
      }
      const outcome = outcomeFromEmission(value);
      yield outcome;
      if (outcome.status !== "running") return;
    }
    yield outcomeFromEmission(
      toolFailed({
        code: "INTERNAL_TOOL_PROTOCOL_ERROR",
        message: "streaming tool ended without a terminal result",
        retryable: false,
        source: "chat",
      }),
    );
  } catch (error) {
    if (shouldRethrowToolError(error, options.abortSignal)) throw error;
    yield caughtErrorOutcome(error, options.toolCallId);
  }
}

function wrapToolDefinition(
  definition: ToolSet[string],
  options: { strictByDefault: boolean },
): ToolSet[string] {
  const candidate = definition as ToolSet[string] & {
    outputSchema?: z.ZodType<unknown>;
    execute?: (
      input: unknown,
      options: { abortSignal?: AbortSignal; toolCallId?: string },
    ) => unknown;
    toModelOutput?: (options: Record<string, unknown> & { output: unknown }) => unknown;
  };
  const dataSchema = candidate.outputSchema ?? z.unknown();
  const execute = candidate.execute;
  const toModelOutput = candidate.toModelOutput;

  const modelOutput = (
    options: Record<string, unknown> & { output: ToolOutcome },
  ): ToolResultOutput | PromiseLike<ToolResultOutput> => {
    const { output } = options;
    if (output.status === "completed") {
      return toModelOutput
        ? (toModelOutput({ ...options, output: output.data }) as
            | ToolResultOutput
            | PromiseLike<ToolResultOutput>)
        : { type: "json", value: (output.data ?? null) as JSONValue };
    }
    if (output.status === "blocked" || output.status === "failed") {
      return { type: "error-json", value: output.error as JSONValue };
    }
    return { type: "json", value: output as JSONValue };
  };

  return {
    ...candidate,
    ...(options.strictByDefault && "inputSchema" in candidate
      ? { strict: candidate.strict ?? true }
      : {}),
    outputSchema: toolOutcomeSchema(dataSchema),
    ...(execute
      ? {
          execute: (
            input: unknown,
            options: { abortSignal?: AbortSignal; toolCallId?: string },
          ) => {
            try {
              const result = execute(input, options);
              if (isAsyncIterable(result)) return wrapAsyncToolResult(result, options);
              return Promise.resolve(result)
                .then((data) =>
                  isToolEmission(data)
                    ? outcomeFromEmission(data)
                    : ({ ok: true, status: "completed", data } satisfies ToolOutcome),
                )
                .catch((error: unknown) => {
                  if (shouldRethrowToolError(error, options.abortSignal)) throw error;
                  return caughtErrorOutcome(error, options.toolCallId);
                });
            } catch (error) {
              if (shouldRethrowToolError(error, options.abortSignal)) throw error;
              return caughtErrorOutcome(error, options.toolCallId);
            }
          },
        }
      : {}),
    toModelOutput: modelOutput,
  } as unknown as ToolSet[string];
}

export function defineAgentTool(
  name: string,
  definition: ToolSet[string],
  policy: Omit<AgentToolPolicy, "source"> & { source?: AgentToolPolicy["source"] },
  planning: AgentToolPlanning,
  availability: ToolAvailability = "available",
): AgentToolManifest {
  const resolvedPolicy = { source: "builtin" as const, ...policy };
  const agentMetadata = {
    capability: resolvedPolicy.capability,
    effect: resolvedPolicy.effect,
    execution: resolvedPolicy.execution,
    modes: resolvedPolicy.modes,
    source: resolvedPolicy.source,
    trust: resolvedPolicy.trust,
    ...(resolvedPolicy.uiKind ? { uiKind: resolvedPolicy.uiKind } : {}),
    ...(resolvedPolicy.visibility ? { visibility: resolvedPolicy.visibility } : {}),
  } satisfies JSONObject;

  return {
    name,
    tool: {
      ...wrapToolDefinition(definition, {
        strictByDefault: resolvedPolicy.source === "builtin",
      }),
      metadata: {
        ...(definition.metadata ?? {}),
        agent: agentMetadata,
      },
    },
    policy: resolvedPolicy,
    planning,
    availability,
  };
}

export function defineUnavailableCapability(
  name: string,
  policy: Omit<AgentToolPolicy, "source"> & { source?: AgentToolPolicy["source"] },
  planning: AgentToolPlanning,
): AgentToolManifest {
  return {
    name,
    policy: { source: "builtin", ...policy },
    planning,
    availability: "requires-configuration",
  };
}

export function manifestsToTools(manifests: AgentToolManifest[]): ToolSet {
  return Object.fromEntries(
    manifests.flatMap((manifest) => (manifest.tool ? [[manifest.name, manifest.tool]] : [])),
  );
}

export function renderExecutionCapabilities(manifests: AgentToolManifest[]): string {
  const executionCapabilities = manifests.filter(
    (manifest) =>
      manifest.policy.modes.includes("normal") &&
      !manifest.policy.modes.includes("plan") &&
      manifest.policy.capability !== "planning",
  );
  if (executionCapabilities.length === 0) return "";

  const lines = executionCapabilities.map((manifest) => {
    const details = [
      manifest.planning.summary,
      manifest.planning.parallelizable ? "May run alongside independent deliverables." : null,
      ...(manifest.planning.constraints ?? []),
      ...(manifest.planning.prerequisites ?? []).map((value) => `Prerequisite: ${value}`),
    ].filter((value): value is string => Boolean(value));
    return `- ${manifest.name} [${manifest.availability}]: ${details.join(" ")}`;
  });

  return [
    "<execution_capabilities>",
    "These tools are available only after the plan is approved. Include them in the plan when appropriate; do not call them in plan mode.",
    ...lines,
    "</execution_capabilities>",
  ].join("\n");
}

export function toolPolicyFromMetadata(metadata: unknown): AgentToolPolicy | null {
  if (!metadata || typeof metadata !== "object") return null;
  const agent = (metadata as { agent?: unknown }).agent;
  if (!agent || typeof agent !== "object") return null;
  const value = agent as Partial<AgentToolPolicy>;
  if (
    typeof value.source !== "string" ||
    typeof value.effect !== "string" ||
    typeof value.capability !== "string" ||
    typeof value.trust !== "string" ||
    typeof value.execution !== "string" ||
    !Array.isArray(value.modes)
  ) {
    return null;
  }
  return value as AgentToolPolicy;
}
