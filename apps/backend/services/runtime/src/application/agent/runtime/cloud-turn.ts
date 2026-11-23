import type { LanguageModelV4CallOptions, LanguageModelV4Middleware } from "@ai-sdk/provider";
import type { InferToolSetContext } from "@ai-sdk/provider-utils";
import {
  type TurnScope,
  appendWorkspaceChangeEvent,
  attachExecutionEnvironment,
  assembleInstructions,
  type RuntimeTurnSettings,
  transformToolPreservingCaller,
  isToolOutcome,
  MODEL_STREAM_RETRIES,
  createModelStreamRetryPolicy,
  retryableModelStreamMiddleware,
  EMPTY_RUNTIME_TOKEN_USAGE,
  finalizeSessionContext,
} from "@repo/agent-runtime";
import { InvalidToolInputError } from "ai";
import type { ToolSet } from "ai";

import { finishSpan, runWithActiveSpan, startSpan } from "#runtime/foundation";

import { getServerSettings } from "../../../config/server.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { createInferenceModel } from "../../inference/provider.js";
import { RunSandbox } from "../adapters/cloud-sandbox.js";
import { estimateSessionContext, type ContextEstimate } from "../context/context-snapshot.js";
import {
  captureModelStepContext,
  finishModelStep,
  extractUsageTokens,
  recordRejectedToolCall,
  recordToolEnd,
  sanitizeToolInput,
  startModelStep,
} from "../observability/lifecycle.js";
import { assertRunLease, claimToolEffect } from "../runs/repository.js";
import type { ToolCatalog } from "../tools/catalog.js";
import type { AgentRuntimeContext, CloudTurnInput } from "./types.js";

function observe(label: string, operation: Promise<void>): Promise<void> {
  return operation.catch((error) => {
    logger.error({ err: error }, `${label} failed`);
  });
}

function storedContinuationPrompt(
  prompt: LanguageModelV4CallOptions["prompt"],
): LanguageModelV4CallOptions["prompt"] | null {
  let assistant = prompt.length - 1;
  while (assistant >= 0 && prompt[assistant]?.role !== "assistant") assistant--;
  if (assistant < 0) return null;
  const suffix = prompt.slice(assistant + 1);
  if (suffix.length === 0 || suffix.some((message) => message.role !== "user" && message.role !== "tool")) return null;
  return [...prompt.filter((message) => message.role === "system"), ...suffix];
}

type ExecutableTool = ToolSet[string] & {
  execute: (...args: unknown[]) => unknown;
};

function toolCallIdFromOptions(options: unknown): string | undefined {
  if (!options || typeof options !== "object") {
    return undefined;
  }
  const value = options as { toolCall?: unknown; toolCallId?: unknown };
  if (typeof value.toolCallId === "string") {
    return value.toolCallId;
  }
  if (value.toolCall && typeof value.toolCall === "object") {
    const toolCallId = (value.toolCall as { toolCallId?: unknown }).toolCallId;
    if (typeof toolCallId === "string") {
      return toolCallId;
    }
  }
  return undefined;
}

function withActiveToolSpans(
  tools: ToolSet,
  toolSpans: Map<string, ReturnType<typeof startSpan>>,
  ownedToolEffects: Set<string>,
  input: CloudTurnInput,
  stepNumber: () => number,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      if (!("execute" in definition) || typeof definition.execute !== "function") {
        return [name, definition];
      }
      return [
        name,
        transformToolPreservingCaller(definition, (candidate) => {
          const execute = (candidate as ExecutableTool).execute;
          return {
            ...candidate,
            execute: async (...args: unknown[]) => {
              input.signal?.throwIfAborted();
              await assertRunLease({ runId: input.runId, attemptEpoch: input.attemptEpoch });
              input.signal?.throwIfAborted();
              const toolCallId = toolCallIdFromOptions(args[1]);
              if (toolCallId) {
                const effect = await claimToolEffect({
                  runId: input.runId,
                  attemptEpoch: input.attemptEpoch,
                  toolCallId,
                  toolName: name,
                  toolInput: args[0],
                  observedToolInput: sanitizeToolInput(name, args[0]),
                  stepIndex: stepNumber(),
                });
                if (effect.state === "replay") return effect.output;
                ownedToolEffects.add(toolCallId);
              }
              const span = toolCallId ? toolSpans.get(toolCallId) : undefined;
              if (!span) {
                return await execute(...args);
              }
              return await runWithActiveSpan(span, () => execute(...args));
            },
          } satisfies ExecutableTool;
        }),
      ];
    }),
  );
}

export async function prepareCloudTurn(input: CloudTurnInput, toolCatalog: ToolCatalog, scope: TurnScope) {
  const provider = input.provider;
  let previousResponseId = input.previousResponseId ?? null;
  let responseId: string | null = null;
  let parentResponseId = previousResponseId;
  let statelessReplay = false;
  const loadSkillBody = input.loadSkillBody;
  const loadSkillFile = input.loadSkillFile;
  const skillSource = {
    skills: loadSkillBody
      ? (input.skills ?? []).map((skill) => ({
          ...skill,
          loadBody: () => loadSkillBody(skill.id),
          ...(loadSkillFile ? { loadFile: (path: string) => loadSkillFile(skill.id, path) } : {}),
        }))
      : [],
    activeSkillName: input.activeSkillName,
  };
  const resolvedTools = await toolCatalog.resolve(
    {
      turnId: input.runId,
      threadId: input.sessionId,
      userId: input.userId,
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      workspaceRole: input.workspaceRole ?? "",
      signal: input.signal,
    },
    {
      textProvider: provider,
    },
    input.pluginSnapshot,
    skillSource,
    { approvalPolicy: input.approvalPolicy, permissionProfile: input.permissionProfile },
    input.continuation,
  );
  scope.defer(resolvedTools.dispose);
  const { tools } = resolvedTools;
  const toolContext = {
    workspaceRole: input.workspaceRole ?? "",
    runId: input.runId,
    attemptEpoch: input.attemptEpoch.toString(),
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
  };
  const toolsContext = Object.fromEntries(
    Object.entries(tools)
      .filter(([, definition]) => "contextSchema" in definition && definition.contextSchema)
      .map(([name]) => [name, toolContext]),
  ) as unknown as InferToolSetContext<typeof tools>;
  let currentStepNumber = 0;
  const contextEstimates = new Map<number, ContextEstimate>();
  const modelStepSpans = new Map<number, ReturnType<typeof startSpan>>();
  const toolSpans = new Map<string, ReturnType<typeof startSpan>>();
  const ownedToolEffects = new Set<string>();
  const instrumentedTools = withActiveToolSpans(tools, toolSpans, ownedToolEffects, input, () => currentStepNumber);

  // Stable workspace restore/persistence is host-owned; model-selected permissions
  // apply only to model-visible commands and file tools.
  const sandbox = new RunSandbox(
    toolContext,
    undefined,
    input.signal,
    resolvedTools.permissionProfile,
    resolvedTools.processManager,
  );
  scope.defer(() => sandbox.dispose());
  await sandbox.observeWorkspaceBaseline();
  const runtimeContext: AgentRuntimeContext = {
    runId: input.runId,
    attemptEpoch: input.attemptEpoch,
    userId: input.userId,
    sessionId: input.sessionId,
  };
  const instructions = attachExecutionEnvironment(
    assembleInstructions(
      { ...input.instructionInput, activatedSkill: resolvedTools.activatedSkill },
      resolvedTools.contributions,
    ),
    resolvedTools.environment,
  );
  const providerModel = createInferenceModel(provider, input.reasoningEffort);
  const modelRetry = createModelStreamRetryPolicy({
    signal: input.signal,
    emit: (event) => input.onModelRetry?.(event),
  });
  const { toolSources } = resolvedTools;
  const contextCaptureMiddleware: LanguageModelV4Middleware = {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      const contextEstimate = estimateSessionContext({
        prompt: params.prompt,
        tools: params.tools,
        toolSources,
      });
      contextEstimates.set(currentStepNumber, contextEstimate);
      const contextSnapshot = finalizeSessionContext(contextEstimate, EMPTY_RUNTIME_TOKEN_USAGE);
      if (contextSnapshot) input.onContextUsage?.({ snapshot: contextSnapshot, estimated: true });
      await observe(
        "capture model context",
        captureModelStepContext({
          runId: input.runId,
          attemptEpoch: input.attemptEpoch,
          stepNumber: currentStepNumber,
          contextEstimate,
        }),
      );
      statelessReplay = params.prompt.some(
        (message) =>
          message.role === "assistant" &&
          message.content.some((part) => part.type === "custom" && part.kind === "openai.compaction"),
      );
      if (statelessReplay) {
        previousResponseId = null;
        return {
          ...params,
          providerOptions: { ...params.providerOptions, openai: { ...params.providerOptions?.openai, store: false } },
        };
      }
      if (previousResponseId) {
        // The retained SDK messages stay complete, even when the wire request is incremental.
        const incrementalPrompt = storedContinuationPrompt(params.prompt);
        if (incrementalPrompt) {
          return {
            ...params,
            prompt: incrementalPrompt,
            providerOptions: {
              ...params.providerOptions,
              openai: { ...params.providerOptions?.openai, previousResponseId },
            },
          };
        }
        previousResponseId = null;
      }
      return params;
    },
  };
  const toolApprovalSecret = getServerSettings().toolApprovalSecret;
  const settings = {
    id: "chat-agent",
    model: providerModel,
    middleware: [retryableModelStreamMiddleware, contextCaptureMiddleware],
    instructions,
    maxOutputTokens: provider.maxOutputTokens,
    maxRetries: 0,
    streamRetries: MODEL_STREAM_RETRIES,
    tools: instrumentedTools,
    // The catalog is dynamic, so its string-keyed ToolSet cannot retain the caller-name literal type.
    experimental_toolCallers: resolvedTools.toolCallers as never,
    activeTools: resolvedTools.activeTools,
    toolApproval: resolvedTools.toolApproval,
    repairToolCall: async ({ toolCall, error }) => {
      await observe(
        "record rejected tool call",
        recordRejectedToolCall({
          runId: input.runId,
          attemptEpoch: input.attemptEpoch,
          toolCallId: toolCall.toolCallId,
          stepNumber: currentStepNumber,
          toolName: toolCall.toolName,
          toolInput: toolCall.input,
          code: InvalidToolInputError.isInstance(error) ? "INVALID_TOOL_INPUT" : "NO_SUCH_TOOL",
          error,
        }),
      );
      return null;
    },
    prepareCall: (settings) => Object.assign({}, settings, { experimental_toolApprovalSecret: toolApprovalSecret }),
    contextLimits: provider,
    compactionRetry: modelRetry,
    remoteCompactionBinding:
      new URL(provider.baseUrl).origin === "https://api.openai.com"
        ? JSON.stringify([provider.id, provider.model])
        : undefined,
    onCompactionUsage: input.onCompactionUsage,
    onCompaction: input.onCompaction,
    onHistoryReplacement: () => {
      previousResponseId = null;
    },
    prepareStep: async ({ messages }) => {
      const changes = (await sandbox.consumeExternalFileChanges()).map((change) => change.path);
      return { messages: appendWorkspaceChangeEvent(messages, changes) };
    },
    // Generic ToolSet context requirements are conditional; the catalog still builds the inferred context map above.
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion
    toolsContext: toolsContext as never,
    runtimeContext,
    onStepStart: (event) => {
      modelRetry.reset();
      currentStepNumber = event.stepNumber;
      modelStepSpans.set(
        currentStepNumber,
        startSpan("agent.model_step", {
          "agent.run_id": input.runId,
          "agent.session_id": input.sessionId,
          "agent.step_number": currentStepNumber,
          "gen_ai.request.model": provider.model,
        }),
      );
      return observe(
        "start model step",
        startModelStep({
          runId: input.runId,
          attemptEpoch: input.attemptEpoch,
          stepNumber: currentStepNumber,
          model: provider.model,
        }),
      );
    },
    onChunk: modelRetry.onChunk,
    onError: modelRetry.onError,
    onStepEnd: (event) => {
      const contextEstimate = contextEstimates.get(currentStepNumber);
      contextEstimates.delete(currentStepNumber);
      const contextUsage = extractUsageTokens(event.usage);
      const contextSnapshot = finalizeSessionContext(contextEstimate, contextUsage);
      if (contextSnapshot)
        input.onContextUsage?.({
          snapshot: contextSnapshot,
          estimated: !(contextUsage.inputTokens != null && contextUsage.inputTokens > 0),
        });
      const span = modelStepSpans.get(currentStepNumber);
      if (span) {
        modelStepSpans.delete(currentStepNumber);
        const tokens = extractUsageTokens(event.usage);
        const performance =
          event.performance && typeof event.performance === "object"
            ? (event.performance as Record<string, unknown>)
            : {};
        finishSpan(span, {
          "gen_ai.response.finish_reasons": [event.finishReason],
          "gen_ai.usage.input_tokens": tokens.inputTokens,
          "gen_ai.usage.output_tokens": tokens.outputTokens,
          "gen_ai.usage.total_tokens": tokens.totalTokens,
          "agent.tool_call_count": event.toolCalls.length,
          "agent.model_step.duration_ms": performance.totalDurationMs,
        });
      }
      parentResponseId = previousResponseId;
      const providerResponseId = event.providerMetadata?.openai?.responseId;
      responseId = statelessReplay
        ? null
        : typeof providerResponseId === "string"
          ? providerResponseId
          : typeof event.response.id === "string"
            ? event.response.id
            : null;
      previousResponseId = !statelessReplay && typeof providerResponseId === "string" ? providerResponseId : null;
      return observe(
        "finish model step",
        finishModelStep({
          runId: input.runId,
          attemptEpoch: input.attemptEpoch,
          stepNumber: currentStepNumber,
          finishReason: event.finishReason,
          usage: event.usage,
          toolCallCount: event.toolCalls.length,
          performance: event.performance,
          response: event.response,
          providerMetadata: event.providerMetadata,
          responseId,
          parentResponseId,
          contextEstimate,
        }),
      );
    },
    onToolExecutionStart: (event) => {
      toolSpans.set(
        event.toolCall.toolCallId,
        startSpan("agent.tool_call", {
          "agent.run_id": input.runId,
          "agent.step_number": currentStepNumber,
          "agent.tool_call_id": event.toolCall.toolCallId,
          "agent.tool_name": event.toolCall.toolName,
        }),
      );
    },
    onToolExecutionEnd: (event) => {
      const executionSucceeded = event.toolOutput.type === "tool-result";
      const outcome = executionSucceeded && isToolOutcome(event.toolOutput.output) ? event.toolOutput.output : null;
      const semanticSuccess = executionSucceeded && outcome?.ok !== false;
      const failure = executionSucceeded ? (outcome?.ok === false ? outcome.error : undefined) : event.toolOutput.error;
      const span = toolSpans.get(event.toolCall.toolCallId);
      if (span) {
        toolSpans.delete(event.toolCall.toolCallId);
        finishSpan(
          span,
          {
            "agent.tool_success": semanticSuccess,
            "agent.tool_duration_ms": event.toolExecutionMs,
            ...(outcome ? { "agent.tool_outcome_status": outcome.status } : {}),
            ...(outcome && outcome.ok === false ? { "agent.tool_retryable": outcome.error.retryable } : {}),
          },
          failure,
        );
      }
      if (!ownedToolEffects.delete(event.toolCall.toolCallId)) return;
      return observe(
        "finish tool",
        recordToolEnd({
          runId: input.runId,
          attemptEpoch: input.attemptEpoch,
          toolCallId: event.toolCall.toolCallId,
          toolName: event.toolCall.toolName,
          success: executionSucceeded,
          output: executionSucceeded ? event.toolOutput.output : undefined,
          error: executionSucceeded ? undefined : event.toolOutput.error,
          durationMs: event.toolExecutionMs,
        }),
      );
    },
  } satisfies RuntimeTurnSettings<AgentRuntimeContext>;
  return {
    settings,
    sandbox,
    host: {
      sandbox,
      catalogDigest: resolvedTools.catalogDigest,
      responseLineage: () => ({ responseId, parentResponseId }),
    },
  };
}
