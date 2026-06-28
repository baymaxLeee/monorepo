import { WorkflowAgent, type ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable } from "workflow";

import { MAX_AGENT_STEPS } from "./agent-config.js";
import { extractMemoryCandidates } from "./agent-memory.js";
import {
  failWorkflowRun,
  finishModelStep,
  finishWorkflowStream,
  persistWorkflowCompletion,
  recordToolEnd,
  recordToolStart,
  startModelStep,
  stepsToAssistantParts,
} from "./agent-lifecycle.js";
import { createProviderModel } from "./agent-provider.js";
import { buildWorkflowTools } from "./agent-tools.js";
import type { ChatWorkflowInput } from "./agent-types.js";

function stepCountAtLeast(limit: number) {
  return ({ steps }: { steps: readonly unknown[] }) => steps.length >= limit;
}

export async function runChatAgent(input: ChatWorkflowInput): Promise<{ text: string }> {
  "use workflow";

  const provider = input.provider;
  const tools = buildWorkflowTools();
  const toolContext = {
    runId: input.runId,
    userId: input.userId,
    conversationId: input.conversationId,
    providerId: provider.id,
    multimodalProviderId: input.multimodalProviderId ?? null,
  };
  const writable = getWritable<ModelCallStreamPart>();
  const agent = new WorkflowAgent({
    id: "chat-agent",
    model: createProviderModel(provider, { reasoningEffort: input.reasoningEffort }),
    instructions: input.instructions,
    tools,
    toolsContext: {
      list_documents: toolContext,
      read_document: toolContext,
      web_search: toolContext,
      create_artifact: toolContext,
      update_artifact: toolContext,
      analyze_image: toolContext,
      propose_memory: toolContext,
    },
    experimental_onStepStart: (event) =>
      startModelStep({ runId: input.runId, stepNumber: event.stepNumber, model: provider.model }),
    onStepEnd: (event) =>
      finishModelStep({
        runId: input.runId,
        stepNumber: event.stepNumber,
        finishReason: event.finishReason,
        usage: event.usage,
        toolCallCount: event.toolCalls.length,
        performance: "performance" in event ? event.performance : undefined,
      }),
    onToolExecutionStart: (event) =>
      recordToolStart({
        runId: input.runId,
        toolCallId: event.toolCall.toolCallId,
        stepNumber: event.stepNumber,
        toolName: event.toolCall.toolName,
        toolInput: event.toolCall.input,
      }),
    onToolExecutionEnd: (event) =>
      recordToolEnd({
        toolCallId: event.toolCall.toolCallId,
        success: event.success,
        output: event.success ? event.output : undefined,
        error: event.success ? undefined : event.error,
        durationMs: event.durationMs,
      }),
  });

  try {
    const result = await agent.stream({
      messages: input.modelMessages,
      writable,
      stopWhen: stepCountAtLeast(MAX_AGENT_STEPS),
      sendFinish: false,
      preventClose: true,
      onError: ({ error }) => console.error("[chat-agent] WorkflowAgent stream error", error),
    });
    const parts = stepsToAssistantParts(result.steps);
    const totalTokens = result.steps.reduce((sum, step) => sum + (step.usage?.totalTokens ?? 0), 0);
    await persistWorkflowCompletion({ runId: input.runId, conversationId: input.conversationId, parts, totalTokens });
    await finishWorkflowStream(writable);
    await extractMemoryCandidates({
      userId: input.userId,
      runId: input.runId,
      provider,
      userText: input.memorySourceText,
    }).catch((err) => {
      console.error("[chat-agent] memory extraction step failed (non-fatal)", err);
      return { created: 0 };
    });
    return { text: result.steps.at(-1)?.text ?? "" };
  } catch (err) {
    console.error("[chat-agent] runChatAgent failed", err);
    await failWorkflowRun({ runId: input.runId, error: err });
    throw err;
  }
}
