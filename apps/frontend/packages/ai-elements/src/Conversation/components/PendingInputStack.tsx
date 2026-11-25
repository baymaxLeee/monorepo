import { memo } from "react";

export interface PendingAgentInput {
  id: string;
  text: string;
  mode: "follow-up" | "next-turn";
  state: "accepted" | "dispatching" | "not_delivered" | "unconfirmed";
}

export const PendingInputStack = memo(function PendingInputStack({ inputs }: { inputs: readonly PendingAgentInput[] }) {
  if (inputs.length === 0) return null;

  return (
    <div className="mx-auto flex w-full max-w-4xl shrink-0 flex-col gap-2 px-4 pb-2">
      {inputs.map((input) => (
        <div key={input.id} className="flex w-full justify-end" aria-label="待发送消息">
          <div className="flex max-w-[85%] flex-col items-end gap-1 rounded-2xl bg-muted px-4 py-2 leading-relaxed">
            <span className="whitespace-pre-wrap break-words">{input.text}</span>
            <span className="text-xs text-muted-foreground">
              {input.state === "unconfirmed"
                ? "发送状态待确认"
                : input.state === "not_delivered"
                  ? "未加入当前任务"
                  : input.mode === "next-turn"
                    ? "已排到下一项"
                    : "已发送，等待当前步骤结束后加入"}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
});
