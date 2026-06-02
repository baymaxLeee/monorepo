import type { JSONContent } from "@tiptap/core";
import type {
  PromptInputSegment,
  PromptInputToken,
  PromptInputValue,
} from "./interface";

const isToken = (value: unknown): value is PromptInputToken => {
  if (!value || typeof value !== "object") return false;
  const token = value as Partial<PromptInputToken>;
  return (
    typeof token.id === "string" &&
    typeof token.kind === "string" &&
    typeof token.label === "string"
  );
};

const pushText = (segments: PromptInputSegment[], text: string) => {
  if (!text) return;
  const previous = segments.at(-1);
  if (previous?.type === "text") {
    previous.text += text;
    return;
  }
  segments.push({ type: "text", text });
};

const visitNode = (node: JSONContent, segments: PromptInputSegment[]) => {
  if (typeof node.text === "string") {
    pushText(segments, node.text);
  }

  if (node.type === "hardBreak") {
    pushText(segments, "\n");
  }

  if (node.type === "promptToken" && isToken(node.attrs)) {
    segments.push({ type: "token", token: node.attrs });
  }

  node.content?.forEach((child) => visitNode(child, segments));
};

export const serializePromptInput = (
  doc: JSONContent,
  files: Record<string, File>,
): PromptInputValue => {
  const segments: PromptInputSegment[] = [];
  doc.content?.forEach((node, index) => {
    if (index > 0) {
      pushText(segments, "\n");
    }
    visitNode(node, segments);
  });

  const tokens = segments
    .filter((segment) => segment.type === "token")
    .map((segment) => segment.token);

  return {
    text: segments
      .map((segment) =>
        segment.type === "text" ? segment.text : `[[${segment.token.id}]]`,
      )
      .join(""),
    segments,
    tokens,
    files,
  };
};
