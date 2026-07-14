import { randomBytes } from "node:crypto";

import { NoSuchToolError, ToolLoopAgent, wrapLanguageModel } from "ai";
import type { ToolSet } from "ai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type { InferToolSetContext } from "@ai-sdk/provider-utils";
import { finishSpan, runWithActiveSpan, startSpan } from "@backend/kernel-ts";

import { getSettings } from "../../config.js";
import { logger } from "../../lib/logger.js";
import {
  finishModelStep,
  extractUsageTokens,
  recordToolEnd,
  recordToolStart,
  startModelStep,
} from "../observability/lifecycle.js";
import { createProviderModel } from "@backend/transport-ts/provider-model";
import { assembleInstructions } from "../context/instructions/index.js";
import { ToolCatalog } from "../tools/catalog.js";
import { createToolApprovalPolicy } from "../tools/policy.js";
import type { AgentRuntimeContext, ChatAgentInput } from "./types.js";
import {
  artifactVerificationDirective,
  createArtifactVerificationState,
  reduceArtifactVerificationSteps,
} from "./artifact-verification.js";
import type { ArtifactVerificationDirective } from "./artifact-verification.js";
import { planToolOrderingMiddleware } from "./plan-tool-ordering.js";

function observe(label: string, operation: Promise<void>): Promise<void> {
  return operation.catch((error) => {
    logger.error({ err: error }, `${label} failed`);
  });
}

type ExecutableTool = ToolSet[string] & {
  execute: (...args: unknown[]) => unknown;
};

function createForcedToolCallModel(
  baseModel: LanguageModelV4,
  directive: Extract<
    ArtifactVerificationDirective,
    { toolName: "html_validate" | "edit_file" }
  >,
): LanguageModelV4 {
  return {
    specificationVersion: "v4",
    provider: baseModel.provider,
    modelId: baseModel.modelId,
    supportedUrls: baseModel.supportedUrls,
    doGenerate: (options) => baseModel.doGenerate(options),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] });
          controller.enqueue({
            type: "tool-call",
            toolCallId: `artifact-gate-${randomBytes(12).toString("hex")}`,
            toolName: directive.toolName,
            input: JSON.stringify(directive.toolInput),
          });
          controller.enqueue({
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: {
              inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 0, text: 0, reasoning: 0 },
            },
          });
          controller.close();
        },
      }),
    }),
  };
}

function toolCallIdFromOptions(options: unknown): string | undefined {
  if (!options || typeof options !== "object") return undefined;
  const value = options as { toolCall?: unknown; toolCallId?: unknown };
  if (typeof value.toolCallId === "string") return value.toolCallId;
  if (value.toolCall && typeof value.toolCall === "object") {
    const toolCallId = (value.toolCall as { toolCallId?: unknown }).toolCallId;
    if (typeof toolCallId === "string") return toolCallId;
  }
  return undefined;
}

function withActiveToolSpans(
  tools: ToolSet,
  toolSpans: Map<string, ReturnType<typeof startSpan>>,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => {
      if (!("execute" in definition) || typeof definition.execute !== "function") {
        return [name, definition];
      }
      const execute = definition.execute as (...args: unknown[]) => unknown;
      return [
        name,
        {
          ...definition,
          execute: (...args: unknown[]) => {
            const toolCallId = toolCallIdFromOptions(args[1]);
            const span = toolCallId ? toolSpans.get(toolCallId) : undefined;
            if (!span) return execute(...args);
            return runWithActiveSpan(span, () => execute(...args));
          },
        } satisfies ExecutableTool,
      ];
    }),
  ) as ToolSet;
}

export async function createToolLoopAgent(
  input: ChatAgentInput,
  toolCatalog: ToolCatalog = new ToolCatalog(),
) {
  const provider = input.provider;
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
    runId: input.runId,
    userId: input.userId,
    orgId: input.orgId,
    conversationId: input.conversationId,
    attachedImageDocumentIds: input.attachedImageDocumentIds,
  };
  const toolsContext = Object.fromEntries(
    Object.entries(tools)
      .filter(([, definition]) => "contextSchema" in definition && definition.contextSchema)
      .map(([name]) => [name, toolContext]),
  ) as unknown as InferToolSetContext<typeof tools>;
  let currentStepNumber = 0;
  const modelStepSpans = new Map<number, ReturnType<typeof startSpan>>();
  const toolSpans = new Map<string, ReturnType<typeof startSpan>>();
  const instrumentedTools = withActiveToolSpans(tools, toolSpans);

  const runtimeContext: AgentRuntimeContext = {
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
    profileId: input.mode,
    runtimeKind: "tool-loop",
    artifactVerification: createArtifactVerificationState(),
  };
  const instructions = assembleInstructions(
    input.instructionInput,
    resolvedTools.contributions,
  );
  const providerModel = createProviderModel(provider, {
    parallelToolCalls: true,
  });
  const defaultModel =
    input.mode === "plan"
      ? wrapLanguageModel({
          model: providerModel,
          middleware: planToolOrderingMiddleware,
        })
      : providerModel;
  const toolApprovalSecret = getSettings().toolApprovalSecret;
  let artifactGatePending = false;
  let artifactGateDirective: Extract<
    ArtifactVerificationDirective,
    { toolName: "html_validate" | "edit_file" }
  > | null = null;
  const loadSkillActiveTools = resolvedTools.activeTools.filter((name) => name !== "load_skill");
  const agent = new ToolLoopAgent<never, typeof tools, AgentRuntimeContext>({
    id: "chat-agent",
    model: defaultModel,
    instructions,
    maxOutputTokens: provider.maxOutputTokens,
    tools: instrumentedTools,
    activeTools: resolvedTools.activeTools,
    toolOrder: [...resolvedTools.activeTools].sort(),
    toolApproval: createToolApprovalPolicy(input.mode),
    stopWhen: ({ steps }) => steps.length >= 20 && !artifactGatePending,
    prepareCall: (settings) => Object.assign({}, settings, { experimental_toolApprovalSecret: toolApprovalSecret }),
    prepareStep: ({ runtimeContext: stepContext, steps, initialInstructions }) => {
      const skillLoadedThisRun = steps.some((step) =>
        step.content.some((part) =>
          part.type === "tool-result" && part.toolName === "load_skill",
        ),
      );
      const activeTools = skillLoadedThisRun
        ? loadSkillActiveTools
        : resolvedTools.activeTools;
      const artifactVerification = reduceArtifactVerificationSteps(
        stepContext.artifactVerification,
        steps,
      );
      const directive = artifactVerificationDirective(
        artifactVerification,
      );
      artifactGatePending = Boolean(
        artifactVerification.current && artifactVerification.current.phase !== "failed",
      );
      artifactGateDirective = directive?.toolName ? directive : null;
      const nextContext = { ...stepContext, artifactVerification };
      if (!directive) {
        return { runtimeContext: nextContext, activeTools, instructions: initialInstructions };
      }
      if (!directive.toolName) {
        return {
          runtimeContext: nextContext,
          activeTools: [],
          toolChoice: "none",
          instructions: `${String(initialInstructions ?? instructions)}\n<artifact_quality_gate>${directive.instruction}</artifact_quality_gate>`,
        };
      }
      return {
        runtimeContext: nextContext,
        model: createForcedToolCallModel(defaultModel, directive),
        activeTools: [directive.toolName],
        toolChoice: { type: "tool", toolName: directive.toolName },
        instructions: `${String(initialInstructions ?? instructions)}\n<artifact_quality_gate>${directive.instruction}</artifact_quality_gate>`,
      };
    },
    repairToolCall: async ({ toolCall, tools: stepTools, error }) => {
      if (
        !NoSuchToolError.isInstance(error) ||
        !artifactGateDirective ||
        !(artifactGateDirective.toolName in stepTools)
      ) {
        return null;
      }
      logger.warn(
        {
          attemptedTool: toolCall.toolName,
          expectedTool: artifactGateDirective.toolName,
          repairReason: error.name,
        },
        "repairing mandatory artifact quality-gate tool call",
      );
      return {
        ...toolCall,
        toolName: artifactGateDirective.toolName,
        input: JSON.stringify(artifactGateDirective.toolInput),
      };
    },
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
      const recorded = observe(
        "finish model step",
        finishModelStep({
          runId: input.runId,
          stepNumber: currentStepNumber,
          finishReason: event.finishReason,
          usage: event.usage,
          toolCallCount: event.toolCalls.length,
          performance: event.performance,
        }),
      );
      const expectedGateTool = artifactGateDirective?.toolName;
      if (
        artifactGatePending &&
        expectedGateTool &&
        !event.toolCalls.some((toolCall) => toolCall.toolName === expectedGateTool)
      ) {
        return recorded.then(() => {
          throw new Error("mandatory artifact quality-gate tool call was not produced");
        });
      }
      return recorded;
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
      const success = event.toolOutput.type === "tool-result";
      const span = toolSpans.get(event.toolCall.toolCallId);
      if (span) {
        toolSpans.delete(event.toolCall.toolCallId);
        finishSpan(
          span,
          {
            "agent.tool_success": success,
            "agent.tool_duration_ms": event.toolExecutionMs,
          },
          success ? undefined : event.toolOutput.error,
        );
      }
      return observe(
        "finish tool",
        recordToolEnd({
          toolCallId: event.toolCall.toolCallId,
          toolName: event.toolCall.toolName,
          success,
          output: success ? event.toolOutput.output : undefined,
          error: success ? undefined : event.toolOutput.error,
          durationMs: event.toolExecutionMs,
        }),
      );
    },
  });
  return { agent, dispose: resolvedTools.dispose };
}
