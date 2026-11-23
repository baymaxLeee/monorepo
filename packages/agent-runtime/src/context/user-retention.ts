import type { ModelMessage, UIMessage, UserModelMessage } from "ai";

import { estimateTextTokens } from "./token-estimate.js";

// These items use the SDK user role for transport. A copied user prompt may
// contain identical text, so provenance must never be inferred from its body.
const runtimeMessages = new WeakSet<UserModelMessage>();

export function runtimeContextMessage(content: string): UserModelMessage {
  const message: UserModelMessage = { role: "user", content };
  runtimeMessages.add(message);
  return message;
}

export function isUserInput(message: ModelMessage): message is UserModelMessage {
  return message.role === "user" && !runtimeMessages.has(message);
}

export function userTextBudget(recentTailTokens: number): number {
  return Math.min(20_000, Math.floor(recentTailTokens / 2));
}

type TranscriptMessage = ModelMessage | UIMessage;

function userText(message: TranscriptMessage): UserModelMessage["content"] | undefined {
  if (message.role !== "user") return;
  if ("content" in message && runtimeMessages.has(message)) return;
  const parts = "parts" in message ? message.parts : message.content;
  if (typeof parts === "string") return parts;
  const text = parts.flatMap((part) => (part.type === "text" ? [{ type: "text" as const, text: part.text }] : []));
  return text.length ? text : undefined;
}

function textCost(content: UserModelMessage["content"]): number {
  return estimateTextTokens(JSON.stringify({ role: "user", content })) + 64;
}

function fitText(original: UserModelMessage["content"], budget: number): UserModelMessage["content"] | undefined {
  if (textCost(original) <= budget) return original;
  const text =
    typeof original === "string"
      ? original
      : original.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
  function excerpt(length: number): string {
    let head = Math.ceil(length / 2);
    let tail = text.length - Math.floor(length / 2);
    // Keep whole code points on both sides of the omission.
    if (head && /[\uD800-\uDBFF]/u.test(text[head - 1]!)) head--;
    if (tail < text.length && /[\uDC00-\uDFFF]/u.test(text[tail]!)) tail++;
    return text.slice(0, head) + "\n[… truncated]\n" + text.slice(tail);
  }
  let low = 0;
  let high = Math.min(text.length, budget * 2);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (textCost(excerpt(middle)) <= budget) low = middle;
    else high = middle - 1;
  }
  return low ? excerpt(low) : undefined;
}

export function retainUserText<T extends TranscriptMessage>(
  messages: readonly T[],
  end: number,
  budget: number,
  exclude?: ReadonlySet<T>,
) {
  let remaining = budget;
  const selected: UserModelMessage[] = [];
  for (let index = end - 1; index >= 0 && remaining > 0; index--) {
    const source = messages[index]!;
    if (exclude?.has(source)) continue;
    const text = userText(source);
    if (!text) continue;
    const content = fitText(text, remaining);
    if (!content) break;
    const tokens = textCost(content);
    selected.push({ role: "user", content });
    remaining -= tokens;
    if (content !== text) break;
  }
  return { selected: selected.reverse(), tokens: budget - remaining };
}
