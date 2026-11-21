import type { ModelMessage } from "ai";

import {
  contextCompactionThreshold,
  effectiveModelInputWindow,
  recentContextTailBudget,
  type ModelContextLimits,
} from "./budget.js";
import { escapeXmlText } from "./instructions/xml.js";
import { estimateTextTokens } from "./token-estimate.js";

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
}): Promise<ModelMessage[]> {
  const { messages, limits } = input;
  const sizes = messages.map((message) => estimateTextTokens(serialize(message)) + 64);
  const estimated = sizes.reduce((total, size) => total + size, 0);
  if (Math.max(estimated, input.previousInputTokens ?? 0) < contextCompactionThreshold(limits)) return messages;
  let keep = messages.length;
  let tokens = 0;
  const budget = recentContextTailBudget(limits);
  while (keep > 0 && tokens + sizes[keep - 1]! <= budget) tokens += sizes[--keep]!;
  // A tool result cannot be replayed without its assistant invocation.
  while (messages[keep]?.role === "tool") keep++;
  if (!keep) return messages;
  keep = input.stepBoundary?.(messages, keep) ?? keep;
  const prefix = messages.slice(0, keep);
  const tail = messages.slice(keep);
  const latestUser = [...messages].reverse().find((message) => message.role === "user");
  let retainedUser: ModelMessage | undefined;
  if (latestUser && !tail.includes(latestUser) && estimateTextTokens(serialize(latestUser)) <= budget) {
    retainedUser = latestUser;
    tail.unshift(latestUser);
  }
  const compacted: ModelMessage = input.compactRemote
    ? await input.compactRemote(prefix)
    : {
        role: "user",
        content: `<compacted_history>\n${escapeXmlText(await input.summarize(prefix.map(serialize)))}\n</compacted_history>`,
      };
  const replacement = [compacted, ...tail];
  if (
    replacement.reduce((count, message) => count + estimateTextTokens(serialize(message)) + 64, 0) >
    effectiveModelInputWindow(limits)
  ) {
    throw new Error("compacted history exceeds model input window");
  }
  await input.onReplacement?.(retainedUser);
  return replacement;
}
