import { useChatStore } from "@repo/ai-elements/conversation/store/useChatStore";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  SidebarTrigger,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Kbd,
  KbdGroup,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  useDefaultLayout,
  usePanelRef,
  useSidebar,
} from "@repo/design-system";
import { memo, useCallback, useLayoutEffect, useMemo, useSyncExternalStore } from "react";
import { Outlet } from "react-router-dom";

import { ChatConversationSidebar } from "./ChatConversationSidebar";
import { ChatInspector } from "./ChatInspector";

const ChatContent = memo(function ChatContent() {
  return (
    <main aria-label="会话" className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <Tooltip>
        <TooltipTrigger render={<SidebarTrigger className="absolute left-3 top-2 z-10" aria-label="切换会话记录" />} />
        <TooltipContent>
          会话记录{" "}
          <KbdGroup>
            <Kbd>⌘ / Ctrl</Kbd>
            <Kbd>B</Kbd>
          </KbdGroup>
        </TooltipContent>
      </Tooltip>
      <Outlet />
    </main>
  );
});

export function ChatPanels() {
  const { open, setOpen, isMobile } = useSidebar();
  const inspectorOpen = useChatStore((s) => s.artifactPreview.open || s.videoProductionWorkspace.open);
  const wideQuery = useMemo(() => window.matchMedia("(min-width: 1024px)"), []);
  const wide = useSyncExternalStore(
    useCallback(
      (notify) => {
        wideQuery.addEventListener("change", notify);
        return () => wideQuery.removeEventListener("change", notify);
      },
      [wideQuery],
    ),
    () => wideQuery.matches,
    () => false,
  );
  const historyPanel = usePanelRef();
  const closeInspector = useCallback(() => {
    const state = useChatStore.getState();
    state.closeArtifactPreview();
    state.closeVideoProductionWorkspace();
  }, []);
  const panelIds = [!isMobile && "history", "conversation", wide && inspectorOpen && "artifact"].filter(
    (id): id is string => Boolean(id),
  );
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: "chat-workspace",
    panelIds,
    onlySaveAfterUserInteractions: true,
  });
  useLayoutEffect(() => {
    if (isMobile) return;
    if (open) historyPanel.current?.expand();
    else historyPanel.current?.collapse();
  }, [open, isMobile, historyPanel]);

  return (
    <>
      {isMobile ? <ChatConversationSidebar /> : null}
      <ResizablePanelGroup
        id="chat-workspace"
        orientation="horizontal"
        defaultLayout={defaultLayout}
        onLayoutChanged={onLayoutChanged}
      >
        {!isMobile ? (
          <ResizablePanel
            key="history"
            id="history"
            panelRef={historyPanel}
            defaultSize="16rem"
            minSize="12rem"
            maxSize="24rem"
            collapsible
            className="min-w-0 overflow-hidden [contain:layout_paint_style]"
            groupResizeBehavior="preserve-pixel-size"
            onResize={(size) => {
              if (size.inPixels > 0 !== open) setOpen(size.inPixels > 0);
            }}
          >
            <ChatConversationSidebar />
          </ResizablePanel>
        ) : null}
        {!isMobile && open ? <ResizableHandle key="history-resize" aria-label="调整会话记录宽度" /> : null}
        <ResizablePanel
          key="conversation"
          id="conversation"
          minSize={isMobile ? 0 : "20rem"}
          className="min-w-0 overflow-hidden [contain:layout_paint_style]"
        >
          <ChatContent />
        </ResizablePanel>
        {wide && inspectorOpen ? <ResizableHandle key="artifact-resize" aria-label="调整预览宽度" /> : null}
        {wide && inspectorOpen ? (
          <ResizablePanel
            key="artifact"
            id="artifact"
            defaultSize="40%"
            minSize="20rem"
            maxSize="70%"
            collapsible
            className="min-w-0 overflow-hidden [contain:layout_paint_style]"
            onResize={(size, _id, previous) => {
              if (previous && size.inPixels === 0 && previous.inPixels > 0) closeInspector();
            }}
          >
            <aside aria-label="Artifact 预览" className="h-full w-full min-w-0 overflow-hidden">
              <ChatInspector />
            </aside>
          </ResizablePanel>
        ) : null}
      </ResizablePanelGroup>
      {!wide ? (
        <Sheet
          open={inspectorOpen}
          onOpenChange={(next) => {
            if (!next) closeInspector();
          }}
        >
          <SheetContent className="w-full gap-0 p-0 sm:max-w-xl" side="right" showCloseButton={false}>
            <SheetHeader className="sr-only">
              <SheetTitle>Artifact 预览</SheetTitle>
              <SheetDescription>查看当前会话的产物</SheetDescription>
            </SheetHeader>
            {inspectorOpen ? <ChatInspector /> : null}
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}
