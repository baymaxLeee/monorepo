import {
  addToolInputExamplesMiddleware,
  ToolLoopAgent,
  wrapLanguageModel,
  type ModelMessage,
  type ToolSet,
  type UserModelMessage,
} from "ai";

import { RuntimeInputControl } from "./input-control.js";
import { createRuntimeInputQueue, type RuntimeInputQueue } from "./input-queue.js";
import type { RuntimeTurnSettings } from "./types.js";

type AgentLoopSettings<C extends Record<string, unknown>> = RuntimeTurnSettings<C> & {
  inputChannel?: RuntimeInputQueue;
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

/** Internal AI SDK adapter. Session and turn lifecycle belong to RuntimeTurn. */
export function createAgentLoop<C extends Record<string, unknown>>(options: AgentLoopSettings<C>) {
  const { inputChannel: providedInputChannel, middleware = [], prepareStep, ...settings } = options;
  const inputChannel = providedInputChannel ?? createRuntimeInputQueue();
  const inputControl = new RuntimeInputControl(inputChannel);
  const prepareNextStep = async (step: Parameters<NonNullable<RuntimeTurnSettings<C>["prepareStep"]>>[0]) => {
    const prepared = await prepareStep?.(step);
    const steeringMessages = step.experimental_steeringMessages ?? [];
    inputControl.prepareStep(steeringMessages);
    const preparedMessages = inputControl.mergeContinuationMessages(prepared?.messages, prepared?.providerOptions);
    return {
      ...prepared,
      ...(preparedMessages
        ? {
            messages:
              steeringMessages.length > 0
                ? preserveSteeringMessages(preparedMessages, steeringMessages)
                : preparedMessages,
          }
        : {}),
    };
  };
  return new ToolLoopAgent<never, ToolSet, C>({
    ...settings,
    tools: inputControl.wrapTools(settings.tools),
    id: settings.id ?? "runtime-agent",
    model: wrapLanguageModel({
      model: options.model,
      middleware: [addToolInputExamplesMiddleware(), ...middleware, inputControl.middleware],
    }),
    toolOrder: settings.toolOrder ?? Object.keys(settings.tools ?? {}).sort(),
    prepareStep: prepareNextStep,
  });
}
