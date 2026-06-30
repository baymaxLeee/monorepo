import { isStepCount, ToolLoopAgent } from "ai";
import type { InferToolSetContext } from "@ai-sdk/provider-utils";

import { MAX_AGENT_STEPS } from "./config.js";
import {
  finishModelStep,
  recordToolEnd,
  recordToolStart,
  startModelStep,
} from "../observability/lifecycle.js";
import { createProviderModel } from "../providers/model.js";
import { defaultToolCatalog, type ToolCatalog } from "../tools/catalog.js";
import type { AgentRuntimeContext, ChatAgentInput } from "./types.js";

function observe(label: string, operation: Promise<void>): Promise<void> {
  return operation.catch((error) => {
    // Trace persistence must never take down the user-facing generation.
    console.error(`[chat-agent] ${label} failed`, error);
  });
}

export async function createToolLoopAgent(
  input: ChatAgentInput,
  toolCatalog: ToolCatalog = defaultToolCatalog,
) {
  const provider = input.provider;
  const resolvedTools = await toolCatalog.resolve({
    mode: input.mode,
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
  });
  const { tools } = resolvedTools;
  const toolContext = {
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
    providerId: provider.id,
    multimodalProviderId: input.multimodalProviderId ?? null,
  };
  const toolsContext = Object.fromEntries(
    Object.entries(tools)
      .filter(([, definition]) => "contextSchema" in definition && definition.contextSchema)
      .map(([name]) => [name, toolContext]),
  ) as unknown as InferToolSetContext<typeof tools>;
  let currentStepNumber = 0;

  const runtimeContext: AgentRuntimeContext = {
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
    profileId: input.mode,
    runtimeKind: "tool-loop",
  };
  const agent = new ToolLoopAgent({
    id: "chat-agent",
    model: createProviderModel(provider, {
      reasoningEffort: input.reasoningEffort,
      parallelToolCalls: true,
    }),
    instructions: [input.instructions, ...resolvedTools.instructions].join("\n\n"),
    maxOutputTokens: provider.maxOutputTokens,
    tools,
    toolsContext,
    runtimeContext,
    stopWhen: isStepCount(MAX_AGENT_STEPS),
    onStepStart: (event) => {
      currentStepNumber = event.stepNumber;
      return observe(
        "start model step",
        startModelStep({
          runId: input.runId,
          stepNumber: currentStepNumber,
          model: provider.model,
        }),
      );
    },
    onStepEnd: (event) =>
      observe(
        "finish model step",
        finishModelStep({
          runId: input.runId,
          stepNumber: currentStepNumber,
          finishReason: event.finishReason,
          usage: event.usage,
          toolCallCount: event.toolCalls.length,
          performance: event.performance,
        }),
      ),
    onToolExecutionStart: (event) =>
      observe(
        "start tool",
        recordToolStart({
          runId: input.runId,
          toolCallId: event.toolCall.toolCallId,
          stepNumber: currentStepNumber,
          toolName: event.toolCall.toolName,
          toolInput: event.toolCall.input,
        }),
      ),
    onToolExecutionEnd: (event) => {
      const success = event.toolOutput.type === "tool-result";
      return observe(
        "finish tool",
        recordToolEnd({
          toolCallId: event.toolCall.toolCallId,
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
