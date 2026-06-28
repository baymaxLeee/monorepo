import { isStepCount, ToolLoopAgent } from "ai";

import { MAX_AGENT_STEPS } from "./agent-config.js";
import {
  finishModelStep,
  recordToolEnd,
  recordToolStart,
  startModelStep,
} from "./agent-lifecycle.js";
import { createProviderModel } from "./agent-provider.js";
import { buildAgentTools } from "./agent-tools.js";
import type { ChatAgentInput } from "./agent-types.js";

function pruneArtifactWrites<T extends readonly unknown[]>(messages: T): T {
  const removableCalls = new Set<string>();
  for (const message of messages.slice(0, -2)) {
    if (!message || typeof message !== "object" || !("content" in message)) continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const row = part as Record<string, unknown>;
      if (
        row.type === "tool-call" &&
        row.toolName === "write_artifact_part" &&
        typeof row.toolCallId === "string"
      ) {
        removableCalls.add(row.toolCallId);
      }
    }
  }
  return messages.map((message, index) => {
    if (
      index >= messages.length - 2 ||
      !message ||
      typeof message !== "object" ||
      !("content" in message)
    ) {
      return message;
    }
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return message;
    return {
      ...message,
      content: content.filter((part) => {
        if (!part || typeof part !== "object") return true;
        const row = part as Record<string, unknown>;
        return !(
          typeof row.toolCallId === "string" && removableCalls.has(row.toolCallId)
        );
      }),
    };
  }) as unknown as T;
}

function observe(label: string, operation: Promise<void>): Promise<void> {
  return operation.catch((error) => {
    // Trace persistence must never take down the user-facing generation.
    console.error(`[chat-agent] ${label} failed`, error);
  });
}

export function createChatAgent(input: ChatAgentInput) {
  const provider = input.provider;
  const tools = buildAgentTools();
  const toolContext = {
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
    providerId: provider.id,
    multimodalProviderId: input.multimodalProviderId ?? null,
  };
  let currentStepNumber = 0;

  return new ToolLoopAgent({
    id: "chat-agent",
    model: createProviderModel(provider, {
      reasoningEffort: input.reasoningEffort,
    }),
    instructions: input.instructions,
    tools,
    toolsContext: {
      update_plan: toolContext,
      list_documents: toolContext,
      read_document: toolContext,
      web_search: toolContext,
      create_artifact: toolContext,
      begin_artifact: toolContext,
      write_artifact_part: toolContext,
      publish_artifact: toolContext,
      update_artifact: toolContext,
      analyze_image: toolContext,
      propose_memory: toolContext,
    },
    stopWhen: isStepCount(MAX_AGENT_STEPS),
    prepareStep: ({ messages }) => ({ messages: pruneArtifactWrites(messages) }),
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
}
