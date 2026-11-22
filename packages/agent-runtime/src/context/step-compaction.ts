import type { ModelMessage } from "ai";

import { resolveContextWindow, type ModelContextLimits } from "./budget.js";
import type { ContextCompactionEvent } from "./compaction.js";
import { escapeXmlText } from "./instructions/xml.js";
import { estimateTextTokens, truncateTextToTokenBudget } from "./token-estimate.js";

function serialize(message: ModelMessage) {
  return JSON.stringify(message, function (this: { type?: string }, key, value: unknown) {
    if (key === "providerOptions") return undefined;
    if (
      key === "image" ||
      (key === "data" && (this.type === "file" || this.type === "image" || value instanceof Uint8Array))
    )
      return "[media]";
    return value;
  });
}

export async function compactBeforeSampling(input: {
  messages: ModelMessage[];
  limits: ModelContextLimits;
  stepBoundary?: (messages: ModelMessage[], keep: number) => number;
  onReplacement?: (retainedUser: ModelMessage | undefined) => Promise<void>;
  previousInputTokens?: number;
  compactRemote?: (prefix: ModelMessage[]) => Promise<ModelMessage>;
  summarize: (prefix: string[]) => Promise<string>;
  onCompaction?: (event: ContextCompactionEvent) => void;
}): Promise<ModelMessage[]> {
  const { messages, limits } = input;
  const window = resolveContextWindow(limits);
  const sizes = messages.map((message) => estimateTextTokens(serialize(message)) + 64);
  const estimated = sizes.reduce((total, size) => total + size, 0);
  if (Math.max(estimated, input.previousInputTokens ?? 0) < window.compactAt) return messages;
  let keep = messages.length;
  let tokens = 0;
  const budget = window.recentTailTokens;
  while (keep > 0 && tokens + sizes[keep - 1]! <= budget) tokens += sizes[--keep]!;
  // A tool result cannot be replayed without its assistant invocation.
  while (messages[keep]?.role === "tool") keep++;
  if (!keep) return messages;
  keep = input.stepBoundary?.(messages, keep) ?? keep;
  input.onCompaction?.({ state: "started", phase: "step" });
  const prefix = messages.slice(0, keep);
  const tail = messages.slice(keep);
  tokens = tail.reduce((total, message) => total + estimateTextTokens(serialize(message)) + 64, 0);
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  let retainedUser: ModelMessage | undefined;
  const latestUserTokens = latestUser ? estimateTextTokens(serialize(latestUser)) + 64 : 0;
  if (latestUser && !tail.includes(latestUser) && tokens + latestUserTokens <= budget) {
    retainedUser = latestUser;
    tail.unshift(latestUser);
  }
  const compacted: ModelMessage = input.compactRemote
    ? await input.compactRemote(prefix)
    : {
        role: "user",
        content: `<compacted_history>\n${escapeXmlText(
          truncateTextToTokenBudget(await input.summarize(prefix.map(serialize)), window.summaryMaxTokens),
        )}\n</compacted_history>`,
      };
  const replacement = [compacted, ...tail];
  if (
    replacement.reduce((count, message) => count + estimateTextTokens(serialize(message)) + 64, 0) >
    window.inputCapacity
  ) {
    throw new Error("compacted history exceeds model input window");
  }
  await input.onReplacement?.(retainedUser);
  input.onCompaction?.({ state: "completed", phase: "step" });
  return replacement;
}
