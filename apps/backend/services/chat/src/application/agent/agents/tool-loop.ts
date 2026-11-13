import { DIRECT_TOOL_CALL } from "@ai-sdk/code-mode";
import type { LanguageModelV4Middleware } from "@ai-sdk/provider";
import type { InferToolSetContext } from "@ai-sdk/provider-utils";
import { createAgentHarness } from "@backend/agent-runtime-ts";
import { assembleInstructions } from "@backend/agent-runtime-ts/instructions/index";
import { transformToolPreservingCaller } from "@backend/agent-runtime-ts/manifest";
import { deriveOrchestrationState } from "@backend/agent-runtime-ts/orchestration";
import { isToolOutcome } from "@backend/agent-runtime-ts/outcome";
import { createToolApprovalPolicy } from "@backend/agent-runtime-ts/policy";
import { newMessagesForStoredResponse } from "@backend/agent-runtime-ts/response-continuation";
import { finishSpan, runWithActiveSpan, startSpan } from "@backend/kernel-ts";
import { InvalidToolInputError } from "ai";
import type { ToolSet } from "ai";

import { getSettings } from "../../../bootstrap/config.js";
import { logger } from "../../../infrastructure/observability/logger.js";
import { createInferenceModel } from "../../inference/provider.js";
import { estimateConversationContext, type ContextEstimate } from "../context/context-snapshot.js";
import {
  captureModelStepContext,
  finishModelStep,
  extractUsageTokens,
  recordRejectedToolCall,
  recordToolEnd,
  recordToolStart,
  startModelStep,
} from "../observability/lifecycle.js";
import { RunSandbox } from "../tools/builtins/sandbox-session.js";
import { ToolCatalog } from "../tools/catalog.js";
import type { AgentRuntimeContext, ChatAgentInput } from "./types.js";

function observe(label: string, operation: Promise<void>): Promise<void> {
  return operation.catch((error) => {
    logger.error({ err: error }, `${label} failed`);
  });
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

function withActiveToolSpans(tools: ToolSet, toolSpans: Map<string, ReturnType<typeof startSpan>>): ToolSet {
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
            execute: (...args: unknown[]) => {
              const toolCallId = toolCallIdFromOptions(args[1]);
              const span = toolCallId ? toolSpans.get(toolCallId) : undefined;
              if (!span) {
                return execute(...args);
              }
              return runWithActiveSpan(span, () => execute(...args));
            },
          } satisfies ExecutableTool;
        }),
      ];
    }),
  );
}

export async function createToolLoopAgent(input: ChatAgentInput, toolCatalog: ToolCatalog = new ToolCatalog()) {
  const provider = input.provider;
  const supportsStoredContinuation = provider.responsesDialect !== "deepseek_responses";
  let previousResponseId = supportsStoredContinuation ? (input.previousResponseId ?? null) : null;
  let responseId: string | null = null;
  let parentResponseId = previousResponseId;
  const botSkills = input.botSkills ?? [];
  const loadSkillBody = input.loadSkillBody;
  const loadSkillFile = input.loadSkillFile;
  const skillSource =
    botSkills.length > 0 && loadSkillBody
      ? {
          skills: botSkills,
          activeSkillName: input.activeSkillName,
          loadBody: loadSkillBody,
          loadFile: loadSkillFile,
        }
      : null;
  const resolvedTools = await toolCatalog.resolve(
    {
      projectId: input.projectId,
      canvasId: input.canvasId,
      mode: input.mode,
      runId: input.runId,
      userId: input.userId,
      conversationId: input.conversationId,
    },
    {
      textProvider: provider,
      imageProvider: input.imageProvider ?? null,
      videoProviderId: input.videoProviderId ?? null,
    },
    skillSource,
  );
  const { tools } = resolvedTools;
  const toolContext = {
    projectId: input.projectId,
    canvasId: input.canvasId,
    workspaceRole: input.workspaceRole ?? "",
    runId: input.runId,
    userId: input.userId,
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    attachedImageDocumentIds: input.attachedImageDocumentIds,
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
  const instrumentedTools = withActiveToolSpans(tools, toolSpans);

  const sandbox = new RunSandbox(toolContext);
  await sandbox.observeWorkspaceBaseline();
  const runtimeContext: AgentRuntimeContext = {
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
    profileId: input.mode,
    runtimeKind: "tool-loop",
    orchestration: deriveOrchestrationState([]),
  };
  const instructions = assembleInstructions(input.instructionInput, resolvedTools.contributions);
  const providerModel = createInferenceModel(provider);
  const toolSources = new Map(resolvedTools.manifests.map((manifest) => [manifest.name, manifest.policy.source]));
  const contextCaptureMiddleware: LanguageModelV4Middleware = {
    specificationVersion: "v4",
    transformParams: async ({ params }) => {
      const contextEstimate = estimateConversationContext({
        prompt: params.prompt,
        tools: params.tools,
        toolSources,
      });
      contextEstimates.set(currentStepNumber, contextEstimate);
      await observe(
        "capture model context",
        captureModelStepContext({
          runId: input.runId,
          stepNumber: currentStepNumber,
          contextEstimate,
        }),
      );
      return params;
    },
  };
  const toolApprovalSecret = getSettings().toolApprovalSecret;
  const codeModeToolCallers = Object.fromEntries(
    resolvedTools.codeModeTools.map((name) => [name, ["code_mode", DIRECT_TOOL_CALL] as const]),
  );
  // The provider may emit multiple calls per model response, and the AI SDK executes retained calls concurrently by
  // default because toolCallConcurrency is intentionally unset. The batch middleware only preserves semantic barriers.
  const agent = createAgentHarness<AgentRuntimeContext>({
    id: "chat-agent",
    model: providerModel,
    mode: input.mode,
    middleware: [contextCaptureMiddleware],
    workspace: {
      consumeChanges: async () => (await sandbox.consumeExternalFileChanges()).map((change) => change.path),
    },
    instructions,
    maxOutputTokens: provider.maxOutputTokens,
    timeout: { chunkMs: 120_000 },
    tools: instrumentedTools,
    // The catalog is dynamic, so its string-keyed ToolSet cannot retain the caller-name literal type.
    experimental_toolCallers: codeModeToolCallers as never,
    activeTools: resolvedTools.activeTools,
    toolOrder: [...resolvedTools.activeTools].sort(),
    toolApproval: createToolApprovalPolicy(input.mode),
    repairToolCall: async ({ toolCall, error }) => {
      await observe(
        "record rejected tool call",
        recordRejectedToolCall({
          runId: input.runId,
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
    continuation: ({ steps, messages }) => {
      const toolResultMessages = steps.at(-1)?.response.messages.filter((message) => message.role === "tool") ?? [];
      const continuation =
        previousResponseId && (steps.length === 0 || toolResultMessages.length > 0)
          ? {
              providerOptions: { openai: { previousResponseId } },
              messages: steps.length > 0 ? toolResultMessages : newMessagesForStoredResponse(messages),
            }
          : {};
      return continuation;
    },
    // Generic ToolSet context requirements are conditional; the catalog still builds the inferred context map above.
    // oxlint-disable-next-line typescript/no-unnecessary-type-assertion
    toolsContext: toolsContext as never,
    runtimeContext,
    onStepStart: (event) => {
      currentStepNumber = event.stepNumber;
      modelStepSpans.set(
        currentStepNumber,
        startSpan("agent.model_step", {
          "agent.run_id": input.runId,
          "agent.conversation_id": input.conversationId,
          "agent.profile": input.mode,
          "agent.step_number": currentStepNumber,
          "gen_ai.request.model": provider.model,
        }),
      );
      return observe(
        "start model step",
        startModelStep({
          runId: input.runId,
          stepNumber: currentStepNumber,
          model: provider.model,
        }),
      );
    },
    onStepEnd: (event) => {
      const contextEstimate = contextEstimates.get(currentStepNumber);
      contextEstimates.delete(currentStepNumber);
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
      responseId =
        typeof providerResponseId === "string"
          ? providerResponseId
          : typeof event.response.id === "string"
            ? event.response.id
            : null;
      previousResponseId = supportsStoredContinuation ? responseId : null;
      return observe(
        "finish model step",
        finishModelStep({
          runId: input.runId,
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
      return observe(
        "start tool",
        recordToolStart({
          runId: input.runId,
          toolCallId: event.toolCall.toolCallId,
          stepNumber: currentStepNumber,
          toolName: event.toolCall.toolName,
          toolInput: event.toolCall.input,
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
      return observe(
        "finish tool",
        recordToolEnd({
          toolCallId: event.toolCall.toolCallId,
          toolName: event.toolCall.toolName,
          success: executionSucceeded,
          output: executionSucceeded ? event.toolOutput.output : undefined,
          error: executionSucceeded ? undefined : event.toolOutput.error,
          durationMs: event.toolExecutionMs,
        }),
      );
    },
  });
  return {
    agent,
    sandbox,
    dispose: async () => {
      await Promise.all([sandbox.dispose(), resolvedTools.dispose()]);
    },
    responseLineage: () => ({ responseId, parentResponseId }),
  };
}
