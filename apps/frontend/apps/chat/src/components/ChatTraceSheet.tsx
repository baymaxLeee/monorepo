import { useChatStore } from "@repo/chat/store/useChatStore";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@repo/design-system";
import { useShallow } from "zustand/react/shallow";

import { ChatTracePanel } from "./ChatTracePanel";

export function ChatTraceSheet() {
  const { open, conversationId, runId, refreshKey, setOpen } = useChatStore(
    useShallow((s) => ({
      open: s.tracePanelOpen,
      conversationId: s.traceConversationId,
      runId: s.traceRunId,
      refreshKey: s.traceRefreshKey,
      setOpen: s.setTracePanelOpen,
    })),
  );
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent className="w-full gap-0 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>执行轨迹</SheetTitle>
          <SheetDescription>查看本次运行的步骤和工具调用</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {conversationId && runId ? (
            <ChatTracePanel conversationId={conversationId} runId={runId} refreshKey={refreshKey} />
          ) : (
            <p className="p-4 text-sm text-muted-foreground">暂无运行记录</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
