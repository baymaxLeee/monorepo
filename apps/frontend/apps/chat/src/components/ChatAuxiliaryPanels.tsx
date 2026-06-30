import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "components";
import { ChatTracePanel } from "./ChatTracePanel";
import { MemoryPanel } from "./MemoryPanel";

export type ChatAuxiliaryPanelsProps = {
  memoryOpen: boolean;
  traceOpen: boolean;
  traceConversationId: string | null;
  traceRunId: string | null;
  traceRefreshKey: number;
  onMemoryOpenChange: (open: boolean) => void;
  onTraceOpenChange: (open: boolean) => void;
};

export function ChatAuxiliaryPanels({
  memoryOpen,
  traceOpen,
  traceConversationId,
  traceRunId,
  traceRefreshKey,
  onMemoryOpenChange,
  onTraceOpenChange,
}: ChatAuxiliaryPanelsProps) {
  return (
    <>
      <Sheet open={memoryOpen} onOpenChange={onMemoryOpenChange}>
        <SheetContent
          side="right"
          className="w-full min-w-0 gap-0 overflow-hidden sm:max-w-md"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>记忆</SheetTitle>
            <SheetDescription>
              对话后系统会整理候选记忆，确认后才会长期生效。
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            <MemoryPanel open={memoryOpen} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={traceOpen} onOpenChange={onTraceOpenChange}>
        <SheetContent
          side="right"
          className="w-full min-w-0 gap-0 overflow-hidden sm:max-w-xl"
        >
          <SheetHeader className="shrink-0">
            <SheetTitle>执行轨迹</SheetTitle>
            <SheetDescription>
              ToolLoopAgent 步骤与工具调用时间线
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-auto">
            {traceConversationId && traceRunId ? (
              <ChatTracePanel
                conversationId={traceConversationId}
                runId={traceRunId}
                refreshKey={traceRefreshKey}
              />
            ) : (
              <div className="p-4 text-xs text-muted-foreground">
                暂无可展示的运行。请先在该会话中发送一条消息。
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
