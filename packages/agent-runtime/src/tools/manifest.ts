import type { JSONObject, JSONValue } from "@ai-sdk/provider";
import {
  experimental_getToolCaller as getToolCaller,
  experimental_toolCaller as toolCaller,
  type ToolResultOutput,
} from "@ai-sdk/provider-utils";
import type { ToolSet } from "ai";
import { z } from "zod";

import { ToolExecutionScheduler } from "./execution-scheduler.js";
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
import type { AgentToolManifest, AgentToolPlanning, AgentToolPolicy, ToolAvailability } from "./types.js";

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(value && (typeof value === "object" || typeof value === "function") && Symbol.asyncIterator in value);
}

function attachPlanningGuidance(definition: ToolSet[string], planning: AgentToolPlanning): ToolSet[string] {
  const guidance = [
    ...(planning.prerequisites?.map((item) => `Prerequisite: ${item}`) ?? []),
    ...(planning.constraints?.map((item) => `Constraint: ${item}`) ?? []),
  ];
  if (guidance.length === 0) return definition;
  return transformToolPreservingCaller(
    definition,
    (candidate) =>
      ({
        ...candidate,
        description: [candidate.description, ...guidance].filter(Boolean).join("\n"),
      }) as unknown as ToolSet[string],
  );
}

function caughtErrorOutcome(error: unknown, toolCallId?: string): ToolOutcome {
  return outcomeFromEmission(
    error instanceof ToolBlockedError
      ? toolBlocked(error.issue)
      : toolFailed(normalizeToolIssue(error, toolCallId ? { details: { tool_call_id: toolCallId } } : {})),
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
      if (outcome.status !== "running") {
        return;
      }
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
    if (shouldRethrowToolError(error, options.abortSignal)) {
      throw error;
    }
    yield caughtErrorOutcome(error, options.toolCallId);
  }
}

export function transformToolPreservingCaller(
  definition: ToolSet[string],
  transform: (tool: ToolSet[string]) => ToolSet[string],
): ToolSet[string] {
  const transformed = transform(definition);
  const caller = getToolCaller(definition);
  if (!caller) {
    return transformed;
  }
  return toolCaller(
    transformed,
    caller.type === "local"
      ? {
          ...caller,
          bind: (tools) => transform(caller.bind(tools)),
        }
      : caller,
  );
}

function wrapToolDefinition(definition: ToolSet[string], options: { strictByDefault: boolean }): ToolSet[string] {
  return transformToolPreservingCaller(definition, (current) => {
    const candidate = current as ToolSet[string] & {
      outputSchema?: z.ZodType<unknown>;
      execute?: (input: unknown, options: { abortSignal?: AbortSignal; toolCallId?: string }) => unknown;
      toModelOutput?: (options: Record<string, unknown> & { output: unknown }) => unknown;
    };
    const dataSchema = candidate.outputSchema ?? z.unknown();
    const execute = candidate.execute;
    const toModelOutput = candidate.toModelOutput;
    const modelOutput = (
      modelOptions: Record<string, unknown> & { output: ToolOutcome },
    ): ToolResultOutput | PromiseLike<ToolResultOutput> => {
      const { output } = modelOptions;
      if (output.status === "completed") {
        return toModelOutput
          ? (toModelOutput({ ...modelOptions, output: output.data }) as
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
      ...(options.strictByDefault && "inputSchema" in candidate ? { strict: candidate.strict ?? true } : {}),
      outputSchema: toolOutcomeSchema(dataSchema),
      ...(execute
        ? {
            execute: (input: unknown, options: { abortSignal?: AbortSignal; toolCallId?: string }) => {
              try {
                const result = execute(input, options);
                if (isAsyncIterable(result)) {
                  return wrapAsyncToolResult(result, options);
                }
                return Promise.resolve(result)
                  .then((data) =>
                    isToolEmission(data)
                      ? outcomeFromEmission(data)
                      : ({ ok: true, status: "completed", data } satisfies ToolOutcome),
                  )
                  .catch((error: unknown) => {
                    if (shouldRethrowToolError(error, options.abortSignal)) {
                      throw error;
                    }
                    return caughtErrorOutcome(error, options.toolCallId);
                  });
              } catch (error) {
                if (shouldRethrowToolError(error, options.abortSignal)) {
                  throw error;
                }
                return caughtErrorOutcome(error, options.toolCallId);
              }
            },
          }
        : {}),
      toModelOutput: modelOutput,
    } as unknown as ToolSet[string];
  });
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
    ...(resolvedPolicy.callableByCodeMode ? { callableByCodeMode: true } : {}),
    effect: resolvedPolicy.effect,
    execution: resolvedPolicy.execution,
    source: resolvedPolicy.source,
    trust: resolvedPolicy.trust,
    ...(resolvedPolicy.pluginId ? { pluginId: resolvedPolicy.pluginId } : {}),
    ...(resolvedPolicy.sourceProjection ? { sourceProjection: resolvedPolicy.sourceProjection } : {}),
    ...(resolvedPolicy.streaming ? { streaming: true } : {}),
    ...(resolvedPolicy.uiKind ? { uiKind: resolvedPolicy.uiKind } : {}),
  } satisfies JSONObject;

  const described = attachPlanningGuidance(definition, planning);
  const wrapped = wrapToolDefinition(described, {
    strictByDefault: resolvedPolicy.source === "builtin",
  });
  const wrappedWithMetadata = transformToolPreservingCaller(wrapped, (candidate) => ({
    ...candidate,
    metadata: {
      ...candidate.metadata,
      ...definition.metadata,
      agent: agentMetadata,
    },
  }));

  return {
    name,
    tool: wrappedWithMetadata,
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

/** Keeps an optional tool executable and searchable without sending its full schema on every initial model step. */
export function deferAgentToolLoading(manifest: AgentToolManifest): AgentToolManifest {
  if (!manifest.tool) return manifest;
  return {
    ...manifest,
    tool: transformToolPreservingCaller(manifest.tool, (definition) => ({
      ...definition,
      deferLoading: true,
    })),
  };
}

export function manifestsToTools(manifests: AgentToolManifest[]): ToolSet {
  const names = new Set<string>();
  const tools: ToolSet = {};
  const scheduler = new ToolExecutionScheduler();
  for (const manifest of manifests) {
    if (names.has(manifest.name)) {
      throw new Error(`duplicate agent tool ${manifest.name}`);
    }
    names.add(manifest.name);
    if (manifest.tool) {
      tools[manifest.name] = transformToolPreservingCaller(manifest.tool, (definition) => {
        if (!("execute" in definition) || typeof definition.execute !== "function") return definition;
        const executable = definition as ToolSet[string] & {
          execute(input: unknown, options: { abortSignal?: AbortSignal }): unknown;
        };
        const execute = executable.execute.bind(executable);
        const parallel = manifest.planning.parallelizable === true;
        return {
          ...definition,
          execute: manifest.policy.streaming
            ? (input: unknown, options: { abortSignal?: AbortSignal }) =>
                scheduler.stream(parallel, () => execute(input, options) as AsyncIterable<unknown>, options.abortSignal)
            : (input: unknown, options: { abortSignal?: AbortSignal }) =>
                scheduler.run(parallel, () => execute(input, options), options.abortSignal),
        } as ToolSet[string];
      });
    }
  }
  return tools;
}

export function toolPolicyFromMetadata(metadata: unknown): AgentToolPolicy | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  const agent = (metadata as { agent?: unknown }).agent;
  if (!agent || typeof agent !== "object") {
    return null;
  }
  const value = agent as Partial<AgentToolPolicy>;
  if (
    typeof value.source !== "string" ||
    typeof value.effect !== "string" ||
    typeof value.capability !== "string" ||
    typeof value.trust !== "string" ||
    typeof value.execution !== "string"
  ) {
    return null;
  }
  return value as AgentToolPolicy;
}
