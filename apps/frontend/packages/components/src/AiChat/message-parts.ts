import type { UIMessage } from "ai";

export type UIMessagePart = UIMessage["parts"][number];

export type IndexedUIMessagePart = {
  part: UIMessagePart;
  index: number;
};

export type MergedReasoningPart = {
  text: string;
  isStreaming: boolean;
};

function isReasoningPart(
  part: UIMessagePart,
): part is Extract<UIMessagePart, { type: "reasoning" }> {
  return part.type === "reasoning";
}

export function mergeReasoningParts(
  parts: UIMessagePart[],
  options: { isMessageStreaming?: boolean } = {},
): MergedReasoningPart | null {
  const text = parts
    .filter(isReasoningPart)
    .map((part) => part.text)
    .filter((text) => text.trim().length > 0)
    .join("\n\n");

  if (!text) return null;

  return {
    text,
    isStreaming: Boolean(
      options.isMessageStreaming && parts.at(-1)?.type === "reasoning",
    ),
  };
}

export function withoutReasoningParts(
  parts: UIMessagePart[],
): IndexedUIMessagePart[] {
  return parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => !isReasoningPart(part));
}
