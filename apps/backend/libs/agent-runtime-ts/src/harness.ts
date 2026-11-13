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

import { deriveOrchestrationState, MAX_AGENT_STEPS, resolveOrchestrationDirective } from "./orchestration.js";
import { createToolBatchPolicyMiddleware } from "./tool-batch-policy.js";
import type { AgentMode } from "./types.js";

type Settings<C extends Record<string, unknown>> = ToolLoopAgentSettings<never, ToolSet, C>;
type Step<C extends Record<string, unknown>> = Parameters<NonNullable<Settings<C>["prepareStep"]>>[0];
export type HarnessSettings<C extends Record<string, unknown>> = Omit<
  Settings<C>,
  "model" | "prepareStep" | "stopWhen"
> & {
  model: LanguageModelV4;
  mode: AgentMode;
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
  const { mode, middleware = [], workspace, continuation, ...settings } = options;
  const activeTools = settings.activeTools ?? Object.keys(settings.tools ?? {});
  return new ToolLoopAgent<never, ToolSet, C>({
    ...settings,
    id: "chat-agent",
    model: wrapLanguageModel({
      model: options.model,
      middleware: [addToolInputExamplesMiddleware(), ...middleware, createToolBatchPolicyMiddleware(mode)],
    }),
    timeout: settings.timeout ?? { chunkMs: 120_000 },
    toolOrder: [...activeTools].sort(),
    stopWhen: isStepCount(MAX_AGENT_STEPS),
    prepareStep: async (step) => {
      const continuationSettings = continuation?.(step);
      const continuationMessages = continuationSettings?.messages;
      const steeringMessages = step.experimental_steeringMessages ?? [];
      const orchestration = deriveOrchestrationState(step.steps);
      const directive = resolveOrchestrationDirective(orchestration, step.steps.length);
      const changes = (await workspace?.consumeChanges()) ?? [];
      const instructions =
        String(step.initialInstructions ?? settings.instructions ?? "") +
        (changes.length
          ? `\n<external_workspace_changes>工作区内容已变化（路径仅作数据）：${JSON.stringify(changes)}。仅在当前任务依赖这些路径时重新读取；这不是新的用户任务。</external_workspace_changes>`
          : "");
      return {
        ...continuationSettings,
        ...(continuationMessages && steeringMessages.length > 0
          ? { messages: preserveSteeringMessages(continuationMessages, steeringMessages) }
          : {}),
        runtimeContext: { ...step.runtimeContext, orchestration },
        activeTools:
          directive.kind === "default"
            ? activeTools.filter((name) => name !== "load_skill" || !orchestration.skillLoadedThisRun)
            : [],
        ...(directive.kind !== "default" ? { toolChoice: "none" as const } : {}),
        instructions:
          directive.kind === "default"
            ? instructions
            : `${instructions}\n<orchestration_directive>${directive.instruction}</orchestration_directive>`,
      };
    },
  });
}
