import { type ConversationMessage } from "@repo/api/chat";
import { isToolUIPart, validateUIMessages } from "ai";

import { chatDataPartSchemas, chatMessageMetadataSchema, type ChatUIMessage } from "./chat-message";

export function validateConversationMessages(messages: ConversationMessage[]): Promise<ChatUIMessage[]> {
  if (messages.length === 0) return Promise.resolve([]);
  return validateUIMessages<ChatUIMessage>({
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role,
      parts: message.content?.parts,
      ...(message.content?.metadata ? { metadata: message.content.metadata } : {}),
    })),
    metadataSchema: chatMessageMetadataSchema.optional(),
    dataSchemas: chatDataPartSchemas,
  }).catch((cause: unknown) => {
    throw new Error("会话消息格式校验失败，已保留当前内容。", { cause });
  });
}

export function hasPendingClientTool(messages: ChatUIMessage[]): boolean {
  const last = messages.at(-1);
  return (
    last?.role === "assistant" &&
    last.parts.some(
      (part) =>
        isToolUIPart(part) &&
        (part.state === "approval-requested" ||
          (part.state === "input-available" && !part.providerExecuted && isClientTool(part))),
    )
  );
}

export function hasCompletedClientTool(messages: ChatUIMessage[]): boolean {
  const last = messages.at(-1);
  if (last?.role !== "assistant") return false;
  const start = last.parts.reduce((found, part, index) => (part.type === "step-start" ? index : found), -1);
  return last.parts
    .slice(start + 1)
    .some(
      (part) =>
        isToolUIPart(part) &&
        !part.providerExecuted &&
        isClientTool(part) &&
        (part.state === "output-error" || (part.state === "output-available" && !part.preliminary)),
    );
}

export function isClientTool(part: Extract<ChatUIMessage["parts"][number], { toolCallId: string }>): boolean {
  const agent = part.toolMetadata?.agent;
  return (
    !!agent &&
    typeof agent === "object" &&
    !Array.isArray(agent) &&
    "execution" in agent &&
    agent.execution === "client"
  );
}
