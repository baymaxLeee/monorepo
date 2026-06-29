import { isStepCount, ToolLoopAgent } from "ai";
import type { InferToolSetContext } from "@ai-sdk/provider-utils";

import { MAX_AGENT_STEPS } from "./config.js";
import {
  finishModelStep,
  recordToolEnd,
  recordToolStart,
  startModelStep,
} from "./observability/lifecycle.js";
import { createProviderModel } from "./model/provider.js";
import { resolveAgentCapabilities } from "./capabilities/registry.js";
import type { ChatAgentInput } from "./contract.js";

function observe(label: string, operation: Promise<void>): Promise<void> {
  return operation.catch((error) => {
    // Trace persistence must never take down the user-facing generation.
    console.error(`[chat-agent] ${label} failed`, error);
  });
}

export async function createChatAgent(input: ChatAgentInput) {
  const provider = input.provider;
  const capabilities = await resolveAgentCapabilities({
    mode: input.mode,
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
  });
  const { tools } = capabilities;
  const toolContext = {
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
    providerId: provider.id,
    multimodalProviderId: input.multimodalProviderId ?? null,
  };
  // Every server tool that declares a contextSchema receives the same run
  // context; deriving the map from the tool set keeps it in sync as tools are
  // added or removed (ask_user has no execute/context and is skipped).
  const toolsContext = Object.fromEntries(
    Object.entries(tools)
      .filter(([, definition]) => "contextSchema" in definition && definition.contextSchema)
      .map(([name]) => [name, toolContext]),
  ) as InferToolSetContext<typeof tools>;
  let currentStepNumber = 0;

  const agent = new ToolLoopAgent({
    id: "chat-agent",
    model: createProviderModel(provider, {
      reasoningEffort: input.reasoningEffort,
      parallelToolCalls: true,
    }),
    instructions: [input.instructions, ...capabilities.instructions].join("\n\n"),
    maxOutputTokens: provider.maxOutputTokens,
    tools,
    toolsContext,
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
  return { agent, dispose: capabilities.dispose };
}
