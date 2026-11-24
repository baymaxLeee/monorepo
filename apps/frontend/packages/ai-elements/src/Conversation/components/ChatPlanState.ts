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
export function projectActiveTodoList(messages: ChatUIMessage[]): ActiveTodoList | null {
  let toolCallId: string | null = null;
  let ownerMessageId: string | null = null;
  let todos: TodoItem[] | null = null;
  let deliverableCompletion = emptyDeliverableCompletion();

  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      if (toolUiKind(part) === "todo-list" && part.state === "output-available") {
        const snapshot = parseTodoListOutput(part.output);
        if (snapshot) {
          toolCallId = snapshot.todos.length > 0 ? part.toolCallId : null;
          ownerMessageId = snapshot.todos.length > 0 ? message.id : null;
          todos = snapshot.todos.length > 0 ? snapshot.todos : null;
          deliverableCompletion = emptyDeliverableCompletion();
          continue;
        }
      }
      if (!todos || ownerMessageId !== message.id) continue;
      const kind = toolUiKind(part);
      const deliverable = kind && DELIVERABLE_BY_UI_KIND.get(kind);
      if (deliverable) deliverableCompletion[deliverable].push(deliverablePartStatus(part));
    }
  }

  if (!toolCallId || !todos) return null;
  return {
    revision: JSON.stringify([toolCallId, todos, deliverableCompletion]),
    todos,
    deliverableCompletion,
  };
}

// Plan progress lives in the active composer surface. Approval and failure
// states remain in the transcript because they require user action or diagnosis.
export function visibleMessageParts(parts: ChatUIMessage["parts"]): (ChatUIMessage["parts"][number] | null)[] {
  return parts.map((part) => {
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
