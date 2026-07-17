import { MessageCircleIcon } from "lucide-react";

export function ConversationListPage() {
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center px-4 pb-4">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <MessageCircleIcon
          aria-hidden="true"
          className="size-10 text-muted-foreground/60"
        />
        <div className="space-y-1">
          <h2 className="text-sm font-medium">开启第一个会话</h2>
          <p className="text-sm text-muted-foreground">
            点击左侧「新建」开始对话。
          </p>
        </div>
      </div>
    </div>
  );
}
