import { isToolUIPart, type UIMessage } from "ai";

export function terminalize(messages: UIMessage[], reason: string): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (!isToolUIPart(part) || ["output-available", "output-error", "output-denied"].includes(part.state))
        return part;
      return {
        type: "dynamic-tool" as const,
        toolName: part.type === "dynamic-tool" ? part.toolName : part.type.slice(5),
        toolCallId: part.toolCallId,
        input: part.input ?? {},
        state: "output-error" as const,
        errorText: reason,
      };
    }),
  }));
}
