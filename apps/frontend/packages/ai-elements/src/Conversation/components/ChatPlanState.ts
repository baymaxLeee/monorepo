import { isToolUIPart, type UIMessage } from "ai";

import { parseArtifactOutput } from "../lib/artifact-output";
import type { ChatUIMessage } from "../lib/chat-message";
import { toolUiKind } from "../lib/conversation-messages";
import { parseToolOutcome } from "../lib/tool-outcome";
import { parseGenerateImageOutput } from "./ChatImageCard";
import type { DeliverableCompletion, DeliverableKind, TodoItem } from "./ChatTodoListCard";
import { parseTodoListOutput } from "./ChatTodoListCard";
import { parseGenerateVideoOutput } from "./ChatVideoCard";

type ToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;
type DeliverablePartStatus = DeliverableCompletion[DeliverableKind][number];

export type ActiveTodoList = {
  revision: string;
  todos: TodoItem[];
  deliverableCompletion: DeliverableCompletion;
};

const DELIVERABLE_BY_UI_KIND = new Map<string, DeliverableKind>([
  ["image-gallery", "image"],
  ["video", "video"],
  ["artifact", "artifact"],
]);

function emptyDeliverableCompletion(): DeliverableCompletion {
  return { artifact: [], image: [], video: [] };
}

function deliverablePartStatus(part: ToolPart): DeliverablePartStatus {
  if (part.state === "output-error") {
    return "errorText" in part && /取消|cancel/i.test(part.errorText) ? "cancelled" : "error";
  }
  const output = "output" in part ? part.output : undefined;
  switch (toolUiKind(part)) {
    case "image-gallery": {
      const parsed = parseGenerateImageOutput(output);
      if (parsed?.status === "partial" && parsed.images.length > 0) return "completed";
      if (parsed?.ok === false || parsed?.status === "failed") return "error";
      if (parsed?.status === "cancelled") return "cancelled";
      return parsed?.status === "completed" ? "completed" : "running";
    }
    case "video": {
      const parsed = parseGenerateVideoOutput(output);
      if (parsed?.ok === false || parsed?.status === "failed") return "error";
      if (parsed?.status === "cancelled") return "cancelled";
      return parsed?.status === "completed" && parsed.fileId ? "completed" : "running";
    }
    case "artifact": {
      const outcome = parseToolOutcome(output);
      if (outcome?.ok === false) return "error";
      const artifact = parseArtifactOutput(output);
      if (artifact?.documentId || artifact?.fileId) return "completed";
      return "running";
    }
    default:
      return "running";
  }
}

// The persisted UIMessage tool parts remain authoritative. This projection gives
// the composer one current snapshot without introducing another stream.
export function projectMessageActiveTodoList(message: ChatUIMessage): ActiveTodoList | null | undefined {
  for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex--) {
    const part = message.parts[partIndex];
    if (!isToolUIPart(part) || toolUiKind(part) !== "todo-list" || part.state !== "output-available") continue;
    const snapshot = parseTodoListOutput(part.output);
    if (!snapshot) continue;
    if (snapshot.todos.length === 0) return null;
    const deliverableCompletion = emptyDeliverableCompletion();
    for (const candidate of message.parts.slice(partIndex + 1)) {
      if (!isToolUIPart(candidate)) continue;
      const kind = toolUiKind(candidate);
      const deliverable = kind && DELIVERABLE_BY_UI_KIND.get(kind);
      if (deliverable) deliverableCompletion[deliverable].push(deliverablePartStatus(candidate));
    }
    return {
      revision: JSON.stringify([part.toolCallId, snapshot.todos, deliverableCompletion]),
      todos: snapshot.todos,
      deliverableCompletion,
    };
  }
  return undefined;
}

export function projectActiveTodoList(messages: ChatUIMessage[]): ActiveTodoList | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const projection = projectMessageActiveTodoList(messages[messageIndex]);
    if (projection !== undefined) return projection;
  }
  return null;
}

// Plan progress lives in the active composer surface. Approval and failure
// states remain in the transcript because they require user action or diagnosis.
export function visibleMessageParts(parts: ChatUIMessage["parts"]): (ChatUIMessage["parts"][number] | null)[] {
  return parts.map((part) => {
    if (part.type === "source-url" || part.type === "source-document" || part.type === "step-start") return null;
    if (!isToolUIPart(part) || toolUiKind(part) !== "todo-list") return part;
    if (
      part.state === "approval-requested" ||
      part.state === "approval-responded" ||
      part.state === "output-denied" ||
      part.state === "output-error"
    ) {
      return part;
    }
    if (part.state === "output-available" && !parseTodoListOutput(part.output)) return part;
    return null;
  });
}
