import { getToolName, isToolUIPart, type UIMessage } from "ai";

function loadedNames(output: unknown): string[] {
  if (!output || typeof output !== "object" || !("tools" in output) || !Array.isArray(output.tools)) return [];
  return output.tools.flatMap((tool) =>
    tool && typeof tool === "object" && "name" in tool && typeof tool.name === "string" ? [tool.name] : [],
  );
}

/** Replays client-side tool-search discoveries in transcript order. The returned
 * order is append-only and is used as the schema order on the next Turn. */
export function restoreToolLoadout(messages: readonly UIMessage[]): string[] {
  const loaded = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (!isToolUIPart(part) || getToolName(part) !== "tool_search" || part.state !== "output-available") continue;
      for (const name of loadedNames(part.output)) loaded.add(name);
    }
  }
  return [...loaded];
}
