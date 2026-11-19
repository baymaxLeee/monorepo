import type { LanguageModelV4Middleware, LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";
import type { ModelMessage, ToolSet, UserModelMessage } from "ai";

import { transformToolPreservingCaller } from "../tools/manifest.js";
import type { ToolOutcome } from "../tools/outcome.js";
import { RUNTIME_FOLLOW_UP_PREEMPTED_FINISH_REASON, type RuntimeInputQueue } from "./input-queue.js";

type ExecutableTool = ToolSet[string] & {
  execute: (...args: unknown[]) => unknown;
};

type SuppressedToolCall = {
  toolCallId: string;
  toolName: string;
};

function emptyUsage(): LanguageModelV4Usage {
  return {
    inputTokens: { total: undefined, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: undefined, text: undefined, reasoning: undefined },
  };
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

class FollowUpResponseGate {
  private required = false;
  private attempt: { promise: Promise<boolean>; resolve: (allowed: boolean) => void } | undefined;

  prepareStep(requiresResponse: boolean): void {
    if (requiresResponse) this.required = true;
    if (!this.required) {
      this.attempt = undefined;
      return;
    }
    let resolve: (allowed: boolean) => void = () => {};
    const promise = new Promise<boolean>((settle) => {
      resolve = settle;
    });
    this.attempt = { promise, resolve };
  }

  observeText(delta: string): void {
    if (!this.required || !delta.trim()) return;
    this.required = false;
    this.attempt?.resolve(true);
  }

  finishSampling(): void {
    if (this.required) this.attempt?.resolve(false);
  }

  async allowTool(signal?: AbortSignal): Promise<boolean> {
    if (!this.required || !this.attempt) return true;
    if (!signal) return this.attempt.promise;
    if (signal.aborted) throw abortReason(signal);
    return new Promise<boolean>((resolve, reject) => {
      const onAbort = () => reject(abortReason(signal));
      signal.addEventListener("abort", onAbort, { once: true });
      void this.attempt!.promise.then(
        (allowed) => {
          signal.removeEventListener("abort", onAbort);
          resolve(allowed);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }
}

function blockedToolOutcome(): ToolOutcome {
  return {
    ok: false,
    status: "blocked",
    error: {
      code: "FOLLOW_UP_RESPONSE_REQUIRED",
      message: "Respond visibly to the latest user follow-up before executing more tools.",
      retryable: true,
      source: "agent-runtime",
    },
  };
}

function storedResponseEnabled(providerOptions: unknown): boolean {
  if (!providerOptions || typeof providerOptions !== "object") return false;
  const openai = (providerOptions as { openai?: unknown }).openai;
  return Boolean(
    openai &&
    typeof openai === "object" &&
    typeof (openai as { previousResponseId?: unknown }).previousResponseId === "string",
  );
}

export class RuntimeInputControl {
  private readonly gate = new FollowUpResponseGate();
  private suppressedToolCalls: SuppressedToolCall[] = [];
  private handledFollowUpVersion = 0;

  constructor(private readonly channel: RuntimeInputQueue) {}

  prepareStep(messages: UserModelMessage[]): boolean {
    let hasFollowUp = false;
    for (const message of messages) {
      if (this.channel.activity.modeFor(message) !== "follow-up") continue;
      hasFollowUp = true;
      this.handledFollowUpVersion = Math.max(
        this.handledFollowUpVersion,
        this.channel.activity.followUpVersionFor(message) ?? 0,
      );
    }
    this.gate.prepareStep(hasFollowUp);
    return hasFollowUp;
  }

  mergeContinuationMessages(
    messages: ModelMessage[] | undefined,
    providerOptions: unknown,
  ): ModelMessage[] | undefined {
    const suppressed = this.suppressedToolCalls;
    this.suppressedToolCalls = [];
    if (!storedResponseEnabled(providerOptions) || suppressed.length === 0) return messages;
    const denial = {
      role: "tool",
      content: suppressed.map(({ toolCallId, toolName }) => ({
        type: "tool-result" as const,
        toolCallId,
        toolName,
        output: {
          type: "execution-denied" as const,
          reason: "A newer user follow-up arrived before this call was dispatched.",
        },
      })),
    } satisfies ModelMessage;
    return [...(messages ?? []), denial];
  }

  wrapTools(tools: ToolSet | undefined): ToolSet | undefined {
    if (!tools) return tools;
    return Object.fromEntries(
      Object.entries(tools).map(([name, definition]) => {
        if (!("execute" in definition) || typeof definition.execute !== "function") return [name, definition];
        return [
          name,
          transformToolPreservingCaller(definition, (candidate) => {
            const execute = (candidate as ExecutableTool).execute;
            return {
              ...candidate,
              execute: async (...args: unknown[]) => {
                const options = args[1] as { abortSignal?: AbortSignal } | undefined;
                return (await this.gate.allowTool(options?.abortSignal)) ? execute(...args) : blockedToolOutcome();
              },
            } satisfies ExecutableTool;
          }),
        ];
      }),
    );
  }

  readonly middleware: LanguageModelV4Middleware = {
    specificationVersion: "v4",
    wrapStream: async ({ doStream }) => {
      const handledFollowUpVersion = this.handledFollowUpVersion;
      let preempted = false;
      let sawFinish = false;
      const toolBuffers = new Map<string, LanguageModelV4StreamPart[]>();
      const unsubscribe = this.channel.activity.subscribeFollowUp((version) => {
        if (version > handledFollowUpVersion) preempted = true;
      });
      // Subscribe before inspecting the cursor so an input admitted between
      // prepareStep and this sampling attempt cannot fall through the gap.
      preempted = this.channel.activity.currentFollowUpVersion() > handledFollowUpVersion;
      let result: Awaited<ReturnType<typeof doStream>>;
      try {
        result = await doStream();
      } catch (error) {
        unsubscribe();
        this.gate.finishSampling();
        throw error;
      }
      const flushToolBuffer = (id: string, controller: TransformStreamDefaultController<LanguageModelV4StreamPart>) => {
        for (const part of toolBuffers.get(id) ?? []) controller.enqueue(part);
        toolBuffers.delete(id);
      };
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
            transform: (part, controller) => {
              if (part.type === "tool-input-start") {
                toolBuffers.set(part.id, [part]);
                return;
              }
              if (part.type === "tool-input-delta" || part.type === "tool-input-end") {
                const buffer = toolBuffers.get(part.id);
                if (buffer) {
                  buffer.push(part);
                  return;
                }
              }
              if (part.type === "tool-call") {
                if (preempted) {
                  toolBuffers.delete(part.toolCallId);
                  if (part.providerExecuted !== true) {
                    this.suppressedToolCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName });
                  }
                  return;
                }
                flushToolBuffer(part.toolCallId, controller);
                controller.enqueue(part);
                return;
              }
              if (part.type === "finish") {
                sawFinish = true;
                unsubscribe();
                this.gate.finishSampling();
                if (preempted) {
                  toolBuffers.clear();
                  controller.enqueue({
                    ...part,
                    finishReason: { unified: "stop", raw: RUNTIME_FOLLOW_UP_PREEMPTED_FINISH_REASON },
                  });
                  return;
                }
                for (const id of [...toolBuffers.keys()]) flushToolBuffer(id, controller);
                controller.enqueue(part);
                return;
              }
              if (part.type === "text-delta" && !preempted) this.gate.observeText(part.delta);
              if (
                !preempted ||
                part.type === "stream-start" ||
                part.type === "response-metadata" ||
                part.type === "ping"
              ) {
                controller.enqueue(part);
              }
            },
            flush: (controller) => {
              unsubscribe();
              this.gate.finishSampling();
              if (preempted && !sawFinish) {
                controller.enqueue({
                  type: "finish",
                  finishReason: { unified: "stop", raw: RUNTIME_FOLLOW_UP_PREEMPTED_FINISH_REASON },
                  usage: emptyUsage(),
                });
              }
            },
          }),
        ),
      };
    },
  };
}
