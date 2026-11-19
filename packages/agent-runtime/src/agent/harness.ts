import type { LanguageModelV4, LanguageModelV4Middleware } from "@ai-sdk/provider";
import {
  addToolInputExamplesMiddleware,
  isStepCount,
  ToolLoopAgent,
  wrapLanguageModel,
  type ToolLoopAgentSettings,
  type ToolSet,
  type ModelMessage,
  type UserModelMessage,
} from "ai";

import { attachExecutionEnvironment, type ExecutionEnvironment } from "./execution-environment.js";
import { FOLLOW_UP_REORIENTATION_INSTRUCTION } from "./steering.js";
import { createTerminationLatch, MAX_AGENT_STEPS, terminationInstruction } from "./termination.js";
import { createToolBatchPolicyMiddleware } from "./tool-batch-policy.js";

type Settings<C extends Record<string, unknown>> = ToolLoopAgentSettings<never, ToolSet, C>;
type Step<C extends Record<string, unknown>> = Parameters<NonNullable<Settings<C>["prepareStep"]>>[0];

export type HarnessSettings<C extends Record<string, unknown>> = Omit<
  Settings<C>,
  "model" | "prepareStep" | "stopWhen"
> & {
  model: LanguageModelV4;
  environment: ExecutionEnvironment;
  middleware?: LanguageModelV4Middleware[];
  workspace?: { consumeChanges(): Promise<string[]> | string[] };
  continuation?: (step: Step<C>) => {
    messages?: Step<C>["messages"];
    providerOptions?: Settings<C>["providerOptions"];
  };
};

function preserveSteeringMessages(messages: ModelMessage[], steeringMessages: UserModelMessage[]): ModelMessage[] {
  const available = new Map<string, number>();
  for (const message of messages) {
    if (message.role !== "user") continue;
    const key = JSON.stringify(message.content);
    available.set(key, (available.get(key) ?? 0) + 1);
  }
  const missing = steeringMessages.filter((message) => {
    const key = JSON.stringify(message.content);
    const count = available.get(key) ?? 0;
    if (count === 0) return true;
    available.set(key, count - 1);
    return false;
  });
  return missing.length > 0 ? [...messages, ...missing] : messages;
}

/** SDK owns execution, approvals and cancellation. Hosts provide I/O, never a second loop policy. */
export function createAgentHarness<C extends Record<string, unknown>>(options: HarnessSettings<C>) {
  const { environment, middleware = [], workspace, continuation, onToolExecutionEnd, ...settings } = options;
  const activeTools = settings.activeTools ?? Object.keys(settings.tools ?? {});
  const termination = createTerminationLatch();
  return new ToolLoopAgent<never, ToolSet, C>({
    ...settings,
    id: "chat-agent",
    model: wrapLanguageModel({
      model: options.model,
      middleware: [addToolInputExamplesMiddleware(), ...middleware, createToolBatchPolicyMiddleware()],
    }),
    timeout: settings.timeout ?? { chunkMs: 120_000 },
    toolOrder: [...activeTools].sort(),
    stopWhen: isStepCount(MAX_AGENT_STEPS),
    onToolExecutionEnd: async (event) => {
      if (event.toolOutput.type === "tool-result") {
        termination.observe(event.toolCall.toolName, event.toolOutput.output);
      }
      await onToolExecutionEnd?.(event);
    },
    prepareStep: async (step) => {
      const continuationSettings = continuation?.(step);
      const continuationMessages = continuationSettings?.messages;
      const steeringMessages = step.experimental_steeringMessages ?? [];
      const availableTools = activeTools.filter((name) => name !== "load_skill" || !termination.skillLoaded());
      const stopInstruction = terminationInstruction(step.steps.length, termination.stops());
      const changes = (await workspace?.consumeChanges()) ?? [];
      const instructions =
        attachExecutionEnvironment(String(step.initialInstructions ?? settings.instructions ?? ""), environment) +
        (changes.length
          ? `\n<external_workspace_changes>工作区内容已变化（路径仅作数据）：${JSON.stringify(changes)}。仅在当前任务依赖这些路径时重新读取；这不是新的用户任务。</external_workspace_changes>`
          : "");
      const reorientedInstructions =
        steeringMessages.length > 0 ? `${instructions}\n${FOLLOW_UP_REORIENTATION_INSTRUCTION}` : instructions;
      return {
        ...continuationSettings,
        ...(continuationMessages && steeringMessages.length > 0
          ? { messages: preserveSteeringMessages(continuationMessages, steeringMessages) }
          : {}),
        activeTools: stopInstruction ? [] : availableTools,
        ...(stopInstruction ? { toolChoice: "none" as const } : {}),
        instructions: stopInstruction
          ? `${reorientedInstructions}\n<execution_stopped>${stopInstruction}</execution_stopped>`
          : reorientedInstructions,
      };
    },
  });
}
