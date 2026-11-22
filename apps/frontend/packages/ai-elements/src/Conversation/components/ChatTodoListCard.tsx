import { Plan, PlanContent, PlanHeader, Task, TaskTitle } from "@repo/ai-elements";

import { parseToolOutcome, toolOutcomePayload } from "../lib/tool-outcome";

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type DeliverableKind = "artifact" | "image" | "video";

export type TodoItem = {
  id: string;
  content: string;
  status: TodoStatus;
  deliverable?: DeliverableKind;
};

type DeliverablePartStatus = "running" | "completed" | "error" | "cancelled";
type ResolvedTodoStatus = TodoStatus | "failed";

export type DeliverableCompletion = Record<DeliverableKind, DeliverablePartStatus[]>;

export function parseTodoListOutput(output: unknown): { todos: TodoItem[] } | null {
  const outcome = parseToolOutcome(output);
  if (outcome?.status !== "completed") {
    return null;
  }
  const payload = toolOutcomePayload(outcome);
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const raw = payload as Record<string, unknown>;
  if (!Array.isArray(raw.plan)) {
    return null;
  }
  const todos = raw.plan.flatMap((item, index): TodoItem[] => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const row = item as Record<string, unknown>;
    if (typeof row.step !== "string") {
      return [];
    }
    if (
      row.status !== "pending" &&
      row.status !== "in_progress" &&
      row.status !== "completed" &&
      row.status !== "cancelled"
    ) {
      return [];
    }
    const deliverable =
      row.deliverable === "artifact" || row.deliverable === "image" || row.deliverable === "video"
        ? row.deliverable
        : undefined;
    return [
      {
        id: String(index),
        content: row.step,
        status: row.status as TodoStatus,
        ...(deliverable ? { deliverable } : {}),
      },
    ];
  });
  return { todos };
}

// A whole image request is ONE generate_images call and one gallery part even
// though its prompts are processed serially.
function aggregateStatus(parts: DeliverablePartStatus[]): DeliverablePartStatus | undefined {
  if (parts.length === 0) {
    return undefined;
  }
  if (parts.some((status) => status === "running")) {
    return "running";
  }
  if (parts.some((status) => status === "completed")) {
    return "completed";
  }
  if (parts.some((status) => status === "cancelled")) {
    return "cancelled";
  }
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
  if (!deliverableCompletion) {
    return todos.map((item) => item.status);
  }
  const imageBatch = aggregateStatus(deliverableCompletion.image);
  const cursor: Record<"artifact" | "video", number> = {
    artifact: 0,
    video: 0,
  };
  return todos.map((item) => {
    if (!item.deliverable) {
      return item.status;
    }
    const live =
      item.deliverable === "image" ? imageBatch : deliverableCompletion[item.deliverable][cursor[item.deliverable]++];
    if (live === "completed") {
      return "completed";
    }
    if (live === "running" && item.status !== "completed") {
      return "in_progress";
    }
    if (live === "cancelled" && item.status !== "completed") {
      return "cancelled";
    }
    if (live === "error" && item.status !== "completed") {
      return "failed";
    }
    return item.status;
  });
}

export function isTodoListSettled(todos: TodoItem[], deliverableCompletion?: DeliverableCompletion): boolean {
  if (todos.length === 0) {
    return false;
  }
  return resolveTodoStatuses(todos, deliverableCompletion).every(
    (status) => status === "completed" || status === "cancelled" || status === "failed",
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
    effective: (statuses[index] === "in_progress" ? "running" : statuses[index]) as
      | "pending"
      | "running"
      | "completed"
      | "failed"
      | "cancelled",
  }));
  const done = items.filter((item) => item.effective === "completed").length;
  const cancelled = items.filter((item) => item.effective === "cancelled").length;
  return (
    <Plan>
      <PlanHeader title={`任务清单 · ${done}/${items.length}${cancelled ? ` · 已取消 ${cancelled}` : ""}`} />
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
