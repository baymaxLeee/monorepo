import {
  type Conversation,
  createConversation,
  deleteConversation,
  fetchConversations,
} from "api";
import { Layout, toast } from "components";
import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { cn } from "shared";
import { useShallow } from "zustand/react/shallow";
import { ChatArtifactPanel } from "../components/ChatArtifactPanel";
import { ChatAuxiliaryPanels } from "../components/ChatAuxiliaryPanels";
import { ChatConversationSidebar } from "../components/ChatConversationSidebar";
import { ChatPanelResizeHandle } from "../components/ChatPanelResizeHandle";
import { useChatShellLayout } from "../hooks/useChatShellLayout";
import { useChatStore } from "../store/useChatStore";

export function ChatLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [conversations, setConversations] = useState<Conversation[] | null>(
    null,
  );
  const [creating, setCreating] = useState(false);
  const {
    loadProviders,
    selectedProviderId,
    memoryPanelOpen,
    setMemoryPanelOpen,
    tracePanelOpen,
    traceConversationId,
    traceRunId,
    traceRefreshKey,
    openTracePanel,
    setTracePanelOpen,
    artifactPreview,
  } = useChatStore(
    useShallow((s) => ({
      loadProviders: s.loadProviders,
      selectedProviderId: s.selectedProviderId,
      memoryPanelOpen: s.memoryPanelOpen,
      setMemoryPanelOpen: s.setMemoryPanelOpen,
      tracePanelOpen: s.tracePanelOpen,
      traceConversationId: s.traceConversationId,
      traceRunId: s.traceRunId,
      traceRefreshKey: s.traceRefreshKey,
      openTracePanel: s.openTracePanel,
      setTracePanelOpen: s.setTracePanelOpen,
      artifactPreview: s.artifactPreview,
    })),
  );

  const artifactOpen = artifactPreview.open;
  const closeArtifactPreview = useChatStore((s) => s.closeArtifactPreview);
  const shell = useChatShellLayout(artifactOpen, closeArtifactPreview);
  const sidebarOpen = shell.leftOpen && !(shell.compact && artifactOpen);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("panel") !== "memory") return;
    setMemoryPanelOpen(true);
    params.delete("panel");
    navigate(
      { pathname: location.pathname, search: params.toString() },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate, setMemoryPanelOpen]);

  useEffect(() => {
    if (!shell.compact) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (artifactOpen) closeArtifactPreview();
      else if (shell.leftOpen) shell.toggleLeft();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    artifactOpen,
    closeArtifactPreview,
    shell.compact,
    shell.leftOpen,
    shell.toggleLeft,
  ]);

  const load = useCallback(async () => {
    try {
      const list = await fetchConversations();
      setConversations(list);
      return list;
    } catch (error) {
      toast.error(`加载会话失败：${String(error)}`);
      setConversations([]);
      return [] as Conversation[];
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    if (creating) return;
    setCreating(true);
    try {
      const conv = await createConversation({
        provider_id: selectedProviderId ?? undefined,
      });
      setConversations((prev) => (prev ? [conv, ...prev] : [conv]));
      navigate(`/platform/chat/conversations/${conv.id}`);
    } catch (error) {
      toast.error(`新建会话失败：${String(error)}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteConversation(id);
      const list = await load();
      if (location.pathname.includes(id)) {
        const next = list[0];
        navigate(
          next
            ? `/platform/chat/conversations/${next.id}`
            : "/platform/chat/conversations",
          { replace: true },
        );
      }
    } catch (error) {
      toast.error(`删除会话失败：${String(error)}`);
    }
  }

  function handleOpenTrace(conversationId: string) {
    openTracePanel(conversationId);
    if (!location.pathname.endsWith(`/${conversationId}`)) {
      navigate(`/platform/chat/conversations/${conversationId}`);
    }
  }

  return (
    <Layout className="relative flex h-[calc(100svh-3.5rem)] min-h-0 flex-col scrollbar-hide [&_*]:[scrollbar-width:none] [&_*]:[-ms-overflow-style:none] [&_*::-webkit-scrollbar]:hidden">
      <div
        ref={shell.containerRef}
        className={cn(
          "relative grid min-h-0 flex-1",
          "transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none",
          shell.isDragging && "transition-none",
        )}
        style={{
          gridTemplateColumns: shell.compact
            ? "0 minmax(0, 1fr) 0"
            : `${shell.leftWidth}px minmax(0, 1fr) ${shell.rightWidth}px`,
        }}
      >
        {shell.compact && (sidebarOpen || artifactOpen) ? (
          <button
            type="button"
            className="absolute inset-0 z-20 bg-black/20"
            aria-label="关闭侧栏"
            onClick={artifactOpen ? closeArtifactPreview : shell.toggleLeft}
          />
        ) : null}
        <ChatConversationSidebar
          conversations={conversations}
          activePath={location.pathname}
          creating={creating}
          open={sidebarOpen}
          width={shell.panelLeftWidth}
          compact={shell.compact}
          showToggle={!(shell.compact && artifactOpen)}
          onCreate={() => void handleCreate()}
          onDelete={(id) => void handleDelete(id)}
          onOpenTrace={handleOpenTrace}
          onToggle={shell.toggleLeft}
          onResize={shell.resizeLeft}
          onResizeStart={() => shell.startResize("left-panel")}
          onResizeEnd={() => shell.endResize("left-panel")}
          resizeMin={shell.leftResizeMin}
          resizeMax={shell.leftResizeMax}
        />

        <main className="relative isolate z-[1] col-start-2 flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex h-full min-h-0 w-full flex-col">
            <Outlet />
          </div>
        </main>

        <div
          className={cn(
            "relative z-10 col-start-3 min-w-0 overflow-visible bg-background",
            artifactOpen ? "opacity-100" : "pointer-events-none opacity-0",
            shell.compact &&
              "absolute inset-y-0 right-0 z-30 shadow-xl max-[639px]:w-full",
          )}
          style={
            shell.compact && artifactOpen
              ? {
                  width: `min(${shell.panelRightWidth}px, calc(100% - 3rem))`,
                }
              : undefined
          }
          aria-hidden={!artifactOpen}
        >
          <ChatPanelResizeHandle
            edge="right-panel"
            value={shell.panelRightWidth}
            minValue={shell.rightResizeMin}
            maxValue={shell.rightResizeMax}
            disabled={!artifactOpen}
            onDrag={shell.resizeRight}
            onDragStart={() => shell.startResize("right-panel")}
            onDragEnd={() => shell.endResize("right-panel")}
          />
          <div className="h-full min-w-0 overflow-hidden">
            <ChatArtifactPanel onClose={shell.closeArtifact} />
          </div>
        </div>
      </div>

      <ChatAuxiliaryPanels
        memoryOpen={memoryPanelOpen}
        traceOpen={tracePanelOpen}
        traceConversationId={traceConversationId}
        traceRunId={traceRunId}
        traceRefreshKey={traceRefreshKey}
        onMemoryOpenChange={setMemoryPanelOpen}
        onTraceOpenChange={setTracePanelOpen}
      />
    </Layout>
  );
}
