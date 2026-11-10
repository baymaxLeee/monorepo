import { Button } from "@repo/design-system";

export function ChatSessionIssue({
  issue,
  onRecover,
  onRetry,
  onStop,
}: {
  issue: { kind: "connection" | "history" | "cancel"; message: string };
  onRecover: () => Promise<void>;
  onRetry?: () => Promise<void>;
  onStop: () => Promise<void>;
}) {
  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-4xl flex-wrap items-center gap-2 px-4 py-2 text-sm text-destructive"
    >
      <span>
        {issue.kind === "cancel" ? "停止未确认：" : issue.kind === "history" ? "消息同步失败：" : "连接或生成中断："}
        {issue.message}
      </span>
      <Button variant="outline" size="sm" onClick={() => void (issue.kind === "cancel" ? onStop() : onRecover())}>
        {issue.kind === "cancel" ? "重试停止" : "恢复与同步"}
      </Button>
      {onRetry && issue.kind === "connection" && (
        <Button variant="outline" size="sm" onClick={() => void onRetry()}>
          重试请求
        </Button>
      )}
    </div>
  );
}
