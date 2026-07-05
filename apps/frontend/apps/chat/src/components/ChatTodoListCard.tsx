import { isToolUIPart, type UIMessage } from "ai";
import {
  Plan,
  PlanContent,
  PlanHeader,
  Task,
  TaskTitle,
} from "components/ai-chat";
import {
  parseArtifactOutput,
  parseArtifactTaskOutput,
} from "./ChatArtifactCard";
import { parseGenerateImageOutput } from "./ChatImageCard";
import { parseGenerateVideoOutput } from "./ChatVideoCard";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type DeliverableKind = "artifact" | "image" | "video";

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
  deliverable?: DeliverableKind;
};

type ToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;

type DeliverablePartStatus = "running" | "completed" | "error" | "cancelled";
type ResolvedTodoStatus = TodoStatus | "failed";

export type DeliverableCompletion = Record<
  DeliverableKind,
  DeliverablePartStatus[]
>;

function uiKind(part: ToolPart) {
  if (!("toolMetadata" in part) || !part.toolMetadata) return null;
  const agent = part.toolMetadata.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent)) return null;
  return typeof agent.uiKind === "string" ? agent.uiKind : null;
}

export function parseTodoListOutput(
  output: unknown,
): { todos: TodoItem[] } | null {
  if (!output || typeof output !== "object") return null;
  const raw = output as Record<string, unknown>;
  if (!Array.isArray(raw.todos)) return null;
  const todos = raw.todos.flatMap((item): TodoItem[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.content !== "string")
      return [];
    if (
      row.status !== "pending" &&
      row.status !== "in_progress" &&
      row.status !== "completed" &&
      row.status !== "cancelled"
    ) {
      return [];
    }
    const deliverable =
      row.deliverable === "artifact" ||
      row.deliverable === "image" ||
      row.deliverable === "video"
        ? row.deliverable
        : undefined;
    return [
      {
        id: row.id,
        content: row.content,
        status: row.status as TodoStatus,
        ...(deliverable ? { deliverable } : {}),
      },
    ];
  });
  return { todos };
}

export function findLatestUpdateTodosCallId(
  messages: UIMessage[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts;
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j];
      if (isToolUIPart(part) && uiKind(part) === "todo-list") {
        return part.toolCallId;
      }
    }
  }
  return null;
}

function deliverablePartStatus(part: ToolPart): DeliverablePartStatus {
  if (part.state === "output-error") {
    return "errorText" in part && /取消|cancel/i.test(part.errorText)
      ? "cancelled"
      : "error";
  }
  const output = "output" in part ? part.output : undefined;
  switch (uiKind(part)) {
    case "image-gallery": {
      const parsed = parseGenerateImageOutput(output);
      if (parsed?.ok === false) return "error";
      if (parsed?.status === "cancelled") return "cancelled";
      if (parsed?.status === "failed") return "error";
      return parsed?.status === "completed" ? "completed" : "running";
    }
    case "video": {
      const parsed = parseGenerateVideoOutput(output);
      if (parsed?.ok === false) return "error";
      if (parsed?.status === "cancelled") return "cancelled";
      if (parsed?.status === "failed") return "error";
      return parsed?.status === "completed" && parsed.documentId
        ? "completed"
        : "running";
    }
    case "artifact": {
      if (parseArtifactOutput(output)?.documentId) return "completed";
      const task = parseArtifactTaskOutput(output);
      if (task?.status === "completed") return "completed";
      if (task?.status === "cancelled") return "cancelled";
      if (task?.status === "failed") return "error";
      return "running";
    }
    default:
      return "running";
  }
}

const DELIVERABLE_BY_UI_KIND: Record<string, DeliverableKind> = {
  "image-gallery": "image",
  video: "video",
  artifact: "artifact",
};

// The todo snapshot is a model-authored list that can only be rewritten between
// agent steps, but a parallel html/image/video step blocks (Promise.all) until
// the slowest deliverable finishes. To let each todo advance the instant its own
// deliverable card completes, we read the live tool parts emitted after the
// latest update_todos and map them to todos by `deliverable` type + order.
export function collectDeliverableCompletion(
  messages: UIMessage[],
  latestTodoCallId: string | null,
): DeliverableCompletion {
  const result: DeliverableCompletion = { artifact: [], image: [], video: [] };
  if (!latestTodoCallId) return result;
  let started = false;
  for (const message of messages) {
    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      if (!started) {
        if (part.toolCallId === latestTodoCallId) started = true;
        continue;
      }
      const kind = uiKind(part);
      const deliverable = kind ? DELIVERABLE_BY_UI_KIND[kind] : undefined;
      if (deliverable) result[deliverable].push(deliverablePartStatus(part));
    }
  }
  return result;
}

// A whole image request is ONE batched generate_images call (a single gallery
// part), so every image todo reflects that one batch: running while any part is
// still generating, completed once the batch lands. This also keeps the UI
// correct if the model over-splits posters into several image todos.
function aggregateStatus(
  parts: DeliverablePartStatus[],
): DeliverablePartStatus | undefined {
  if (parts.length === 0) return undefined;
  if (parts.some((status) => status === "running")) return "running";
  if (parts.some((status) => status === "completed")) return "completed";
  if (parts.some((status) => status === "cancelled")) return "cancelled";
  return "error";
}

// Effective per-todo status: the model-authored status, upgraded by the live
// state of the deliverable it is tagged with. Images broadcast the single batch
// state to every image todo; artifacts and videos are distinct documents, so
// they match by order. Shared by the card and the surrounding Tool shell so both
// agree on "all done".
export function resolveTodoStatuses(
  todos: TodoItem[],
  deliverableCompletion?: DeliverableCompletion,
): ResolvedTodoStatus[] {
  if (!deliverableCompletion) return todos.map((item) => item.status);
  const imageBatch = aggregateStatus(deliverableCompletion.image);
  const cursor: Record<"artifact" | "video", number> = {
    artifact: 0,
    video: 0,
  };
  return todos.map((item) => {
    if (!item.deliverable) return item.status;
    const live =
      item.deliverable === "image"
        ? imageBatch
        : deliverableCompletion[item.deliverable][cursor[item.deliverable]++];
    if (live === "completed") return "completed";
    if (live === "running" && item.status !== "completed") return "in_progress";
    if (live === "cancelled" && item.status !== "completed") return "cancelled";
    if (live === "error" && item.status !== "completed") return "failed";
    return item.status;
  });
}

export function isTodoListSettled(
  todos: TodoItem[],
  deliverableCompletion?: DeliverableCompletion,
): boolean {
  if (todos.length === 0) return false;
  return resolveTodoStatuses(todos, deliverableCompletion).every(
    (status) =>
      status === "completed" || status === "cancelled" || status === "failed",
  );
}

export function ChatTodoListCard({
  todos,
  deliverableCompletion,
}: {
  todos: TodoItem[];
  deliverableCompletion?: DeliverableCompletion;
}) {
  const statuses = resolveTodoStatuses(todos, deliverableCompletion);
  const items = todos.map((item, index) => ({
    ...item,
    effective: (statuses[index] === "in_progress"
      ? "running"
      : statuses[index]) as
      | "pending"
      | "running"
      | "completed"
      | "failed"
      | "cancelled",
  }));
  const done = items.filter((item) => item.effective === "completed").length;
  const cancelled = items.filter(
    (item) => item.effective === "cancelled",
  ).length;
  return (
    <Plan>
      <PlanHeader
        title={`任务清单 · ${done}/${items.length}${cancelled ? ` · 已取消 ${cancelled}` : ""}`}
      />
      <PlanContent>
        {items.map((item) => (
          <Task key={item.id} status={item.effective}>
            <TaskTitle>{item.content}</TaskTitle>
          </Task>
        ))}
      </PlanContent>
    </Plan>
  );
}
