import { Button, Input } from "components";
import {
  Plan,
  PlanContent,
  PlanHeader,
  Task,
  TaskDescription,
  TaskTitle,
} from "components/ai-chat";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

type PlanItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "skipped";

type PlanItem = {
  id: string;
  title: string;
  status: PlanItemStatus;
  description?: string;
  dependsOn?: string[];
  result?: { kind: string; id?: string; label?: string; url?: string };
  error?: { message: string; retryable?: boolean };
};

export type PlanSnapshot = {
  schemaVersion: 1;
  planId: string;
  revision: number;
  goal: string;
  status: "active" | "completed" | "abandoned";
  items: PlanItem[];
  explanation?: string;
};

export function parsePlanSnapshot(value: unknown): PlanSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PlanSnapshot>;
  if (
    row.schemaVersion !== 1 ||
    typeof row.planId !== "string" ||
    typeof row.revision !== "number" ||
    typeof row.goal !== "string" ||
    !["active", "completed", "abandoned"].includes(String(row.status)) ||
    !Array.isArray(row.items)
  )
    return null;
  return row as PlanSnapshot;
}

function taskStatus(status: PlanItemStatus) {
  if (status === "in_progress") return "running" as const;
  if (status === "skipped") return "cancelled" as const;
  return status;
}

export function ChatPlanCard({
  plan,
  editable = false,
  onEdit,
}: {
  plan: PlanSnapshot;
  editable?: boolean;
  onEdit?: (plan: PlanSnapshot) => void;
}) {
  const [open, setOpen] = useState(plan.status === "active");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(plan.items);
  const completed = plan.items.filter(
    (item) => item.status === "completed",
  ).length;
  const actionable = plan.items.filter(
    (item) => item.status !== "skipped",
  ).length;
  const aggregate =
    plan.status === "active"
      ? "running"
      : plan.status === "abandoned"
        ? "cancelled"
        : "completed";

  return (
    <Plan>
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <ChevronDownIcon className="size-4" />
        ) : (
          <ChevronRightIcon className="size-4" />
        )}
        <PlanHeader className="min-w-0 flex-1" status={aggregate}>
          <span className="block truncate">{plan.goal}</span>
          <span className="ml-2 text-xs text-muted-foreground">
            {completed}/{actionable}
          </span>
        </PlanHeader>
      </button>
      {open ? (
        <PlanContent className="max-h-72 overflow-y-auto pr-1">
          {plan.explanation ? (
            <p className="text-xs text-muted-foreground">{plan.explanation}</p>
          ) : null}
          {(editing ? draft : plan.items).map((item) => (
            <Task key={item.id} status={taskStatus(item.status)}>
              {editing && item.status === "pending" ? (
                <div className="flex gap-2">
                  <Input
                    value={item.title}
                    onChange={(event) =>
                      setDraft((items) =>
                        items.map((entry) =>
                          entry.id === item.id
                            ? { ...entry, title: event.target.value }
                            : entry,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setDraft((items) =>
                        items.filter((entry) => entry.id !== item.id),
                      )
                    }
                  >
                    删除
                  </Button>
                </div>
              ) : (
                <TaskTitle>{item.title}</TaskTitle>
              )}
              {item.description ? (
                <TaskDescription>{item.description}</TaskDescription>
              ) : null}
              {item.dependsOn?.length ? (
                <TaskDescription>
                  依赖：{item.dependsOn.join("、")}
                </TaskDescription>
              ) : null}
              {item.error ? (
                <TaskDescription className="text-destructive">
                  {item.error.message}
                </TaskDescription>
              ) : null}
              {item.result?.url ? (
                <a
                  className="text-xs text-primary hover:underline"
                  href={item.result.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.result.label ?? "查看结果"}
                </a>
              ) : null}
            </Task>
          ))}
          {editable && plan.status === "active" ? (
            <div className="flex justify-end gap-2 pt-1">
              {editing ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setDraft((items) => [
                        ...items,
                        {
                          id: `task_${Date.now()}`,
                          title: "新任务",
                          status: "pending",
                        },
                      ])
                    }
                  >
                    添加任务
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDraft(plan.items);
                      setEditing(false);
                    }}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onEdit?.({ ...plan, items: draft });
                      setEditing(false);
                    }}
                  >
                    应用调整
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(true)}
                >
                  编辑计划
                </Button>
              )}
            </div>
          ) : null}
        </PlanContent>
      ) : null}
    </Plan>
  );
}
