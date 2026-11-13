import { CornerDownLeft } from "lucide-react";

export interface PendingAgentInput {
  id: string;
  text: string;
  delivery: "steer" | "queue";
  state: "accepted" | "dispatching" | "not_delivered" | "unconfirmed";
}

export function PendingInputStack({ inputs }: { inputs: readonly PendingAgentInput[] }) {
  if (inputs.length === 0) return null;

  return (
    <div
      className="mb-2 overflow-hidden rounded-2xl border bg-background/95 shadow-sm"
      aria-label="待发送消息"
      aria-live="polite"
    >
      {inputs.map((input) => (
        <div
          key={input.id}
          className="flex min-h-11 items-center gap-3 border-b px-4 last:border-b-0"
          title={input.text}
        >
          <CornerDownLeft className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{input.text}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {input.state === "unconfirmed"
              ? "状态待确认"
              : input.state === "not_delivered"
                ? "未加入当前任务"
                : input.delivery === "queue"
                  ? "下一项"
                  : "引导当前任务"}
          </span>
        </div>
      ))}
    </div>
  );
}
