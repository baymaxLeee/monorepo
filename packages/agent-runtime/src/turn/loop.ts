import {
  addToolInputExamplesMiddleware,
  isLoopFinished,
  ToolLoopAgent,
  wrapLanguageModel,
  type ModelMessage,
  type ToolSet,
  type UserModelMessage,
} from "ai";

import { compactTranscript, type RuntimeCompactionState } from "../context/compaction.js";
import { compactRemote, remoteCompactionMessage, type RemoteCheckpoint } from "../context/remote-compaction.js";
import { compactBeforeSampling } from "../context/step-compaction.js";
import { isUserInput } from "../context/user-retention.js";
import type { RuntimeTurnSettings } from "./settings.js";

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
export function createAgentLoop<C extends Record<string, unknown>>(
  options: AgentLoopSettings<C>,
  ownerSignal?: AbortSignal,
) {
  const {
    middleware = [],
    prepareStep,
    contextLimits,
    remoteCompactionBinding,
    onCompactionUsage,
    onCompaction,
    compactionRetry,
    onHistoryReplacement,
    stepCheckpoint,
    ...settings
  } = options;
  // SDK tool callers and workspace notifications also use the user role.
  // Only the original transcript and delivered steering are user input.
  const userInputs = new WeakSet<ModelMessage>();
  const prepareNextStep = async (step: Parameters<NonNullable<RuntimeTurnSettings<C>["prepareStep"]>>[0]) => {
    if (step.stepNumber === 0) {
      for (const message of step.initialMessages) if (isUserInput(message)) userInputs.add(message);
    }
    for (const message of step.experimental_steeringMessages ?? []) userInputs.add(message);
    const prepared = await prepareStep?.(step);
    const latest = step.steps.at(-1);
    if (contextLimits && latest) {
      const local = prepared?.messages ?? step.messages;
      let state: RuntimeCompactionState | RemoteCheckpoint | undefined;
      let toolCallIds: string[] = [];
      const bounded = await compactBeforeSampling({
        messages: local,
        userInputs,
        limits: contextLimits,
        previousInputTokens: latest.usage.inputTokens,
        stepBoundary:
          stepCheckpoint &&
          ((messages, keep) => {
            const completed = new Set(
              step.steps.flatMap((completed) => completed.toolResults.map((result) => result.toolCallId)),
            );
            // End on a complete SDK tool response. The journal can then replay every later step.
            const boundary = messages.findIndex(
              (message, i) =>
                i + 1 >= keep &&
                message.role === "tool" &&
                message.content.length > 0 &&
                message.content.every((part) => part.type === "tool-result" && completed.has(part.toolCallId)),
            );
            if (boundary < 0) return keep;
            const end = messages[boundary]!;
            if (end.role === "tool")
              toolCallIds = end.content.flatMap((part) => (part.type === "tool-result" ? [part.toolCallId] : []));
            return boundary + 1;
          }),
        compactRemote: remoteCompactionBinding
          ? async (messages) => {
              state = (
                await compactRemote({
                  binding: remoteCompactionBinding,
                  model: options.model,
                  messages,
                  tools: options.tools,
                  instructions: options.instructions,
                  signal: ownerSignal,
                  onUsage: onCompactionUsage,
                  retry: compactionRetry,
                })
              ).state;
              return remoteCompactionMessage(state);
            }
          : undefined,
        summarize: async (transcript) => {
          state = (
            await compactTranscript({
              model: options.model,
              limits: contextLimits,
              transcript,
              signal: ownerSignal,
              onUsage: onCompactionUsage,
              retry: compactionRetry,
            })
          ).state;
          return state.summary;
        },
        onReplacement: async (retainedUser) => {
          ownerSignal?.throwIfAborted();
          if (stepCheckpoint && state && toolCallIds.length)
            await stepCheckpoint.save({
              assistantId: stepCheckpoint.assistantId,
              toolCallIds,
              retainUser: !!retainedUser && step.initialMessages.includes(retainedUser),
              compacted: state,
            });
        },
        onCompaction,
      });
      if (bounded !== local) {
        onHistoryReplacement?.();
        return { ...prepared, messages: preserveSteeringMessages(bounded, step.experimental_steeringMessages ?? []) };
      }
    }
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
