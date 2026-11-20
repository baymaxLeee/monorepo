import {
  addToolInputExamplesMiddleware,
  isLoopFinished,
  ToolLoopAgent,
  wrapLanguageModel,
  type ModelMessage,
  type ToolSet,
  type UserModelMessage,
} from "ai";

import type { RuntimeTurnSettings } from "./types.js";

type AgentLoopSettings<C extends Record<string, unknown>> = RuntimeTurnSettings<C>;

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
  const { middleware = [], prepareStep, ...settings } = options;
  const prepareNextStep = async (step: Parameters<NonNullable<RuntimeTurnSettings<C>["prepareStep"]>>[0]) => {
    const prepared = await prepareStep?.(step);
    const steeringMessages = step.experimental_steeringMessages ?? [];
    return {
      ...prepared,
      ...(prepared?.messages
        ? {
            messages:
              steeringMessages.length > 0
                ? preserveSteeringMessages(prepared.messages, steeringMessages)
                : prepared.messages,
          }
        : {}),
    };
  };
  return new ToolLoopAgent<never, ToolSet, C>({
    stopWhen: isLoopFinished(),
    ...settings,
    id: settings.id ?? "runtime-agent",
    model: wrapLanguageModel({
      model: options.model,
      middleware: [addToolInputExamplesMiddleware(), ...middleware],
    }),
    toolOrder: settings.toolOrder ?? Object.keys(settings.tools ?? {}).sort(),
    prepareStep: prepareNextStep,
  });
}
