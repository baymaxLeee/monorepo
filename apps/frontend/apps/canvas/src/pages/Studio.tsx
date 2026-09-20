import { fetchCanvasSettings } from "@repo/api";
import {
  Button,
  Skeleton,
  TooltipProvider,
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@repo/design-system";
import { Provider, useAtom } from "jotai";
import { ArrowLeft, MessageSquare, PanelsTopLeft, Film, PanelLeftClose, PanelLeftOpen, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { CanvasBoard } from "../components/CanvasBoard";
import { CanvasConversation } from "../components/CanvasConversation";
import { DeleteSelectionDialog, type CanvasSelection } from "../components/DeleteSelectionDialog";
import { NodeEditor, type NodeEditorHandle } from "../components/NodeEditor";
import { NodeGeneration } from "../components/NodeGeneration";
import { Storyboard } from "../components/Storyboard";
import { StudioNodePanel, nodeKinds } from "../components/StudioNodePanel";
import { useCanvasGraph } from "../hooks/useCanvasGraph";
import { activeNodeIdAtom, studioViewAtom, nodePanelOpenAtom, chatPanelOpenAtom } from "../store/studio";

import "@xyflow/react/dist/style.css";

export function Component() {
  const { canvasId, projectId } = useParams();
  return canvasId && projectId ? (
    <Provider key={`${projectId}:${canvasId}`}>
      <Studio canvasId={canvasId} projectId={projectId} />
    </Provider>
  ) : null;
}
function Studio({ canvasId, projectId }: { canvasId: string; projectId: string }) {
  const { graph, busy, failed, refresh, mutate } = useCanvasGraph(canvasId);
  const [selected, setSelected] = useAtom(activeNodeIdAtom);
  const [deletion, setDeletion] = useState<CanvasSelection | null>(null);
  const editor = useRef<NodeEditorHandle>(null);
  const navigation = useRef(0);
  const [leftOpen, setLeftOpen] = useAtom(nodePanelOpenAtom);
  const [view, setView] = useAtom(studioViewAtom);
  async function selectNode(id: string | null) {
    const intent = ++navigation.current;
    try {
      await editor.current?.finish();
      if (intent === navigation.current) setSelected(id);
    } catch {
      /* Failed saves retain the active editor. */
    }
  }
  async function changeView(next: "canvas" | "storyboard") {
    try {
      await editor.current?.finish();
      setSelected(null);
      setView(next);
    } catch {
      /* Do not leave an unsaved editing session. */
    }
  }
  async function createNode(type: number) {
    if (!graph) return;
    try {
      await editor.current?.finish();
      const defaults = type >= 5 ? (await fetchCanvasSettings()).defaults : null;
      const providerId =
        (type === 5 ? defaults?.image : type === 6 ? defaults?.video : defaults?.inference)?.provider_id ?? "";
      const id = crypto.randomUUID();
      await mutate([
        {
          id,
          asset_id: "",
          type,
          name: nodeKinds.find((kind) => kind.type === type)?.name ?? "节点",
          text: "",
          prompt: "",
          x: graph.nodes.length * 40,
          y: graph.nodes.length * 40,
          storyboard_rank: type === 6 ? Math.max(0, ...graph.nodes.map((node) => node.storyboard_rank)) + 1024 : 0,
          revision: 0,
          video_input_mode: 1,
          generation_config: {
            provider_id: providerId,
            resolution: "",
            aspect_ratio: "",
            duration_seconds: 0,
            generate_audio: false,
            watermark: false,
          },
          incoming_edges: [],
        },
      ]);
      setSelected(id);
    } catch {
      /* API errors retain the previous state. */
    }
  }
  async function moveShot(id: string, direction: -1 | 1) {
    if (!graph) return;
    try {
      await editor.current?.finish();
      const shots = graph.nodes
        .filter((node) => node.type === 6)
        .sort((a, b) => a.storyboard_rank - b.storyboard_rank || a.id.localeCompare(b.id));
      const index = shots.findIndex((node) => node.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= shots.length) return;
      [shots[index], shots[next]] = [shots[next]!, shots[index]!];
      await mutate((current) =>
        shots.map((node, index) => ({
          ...current.nodes.find((value) => value.id === node.id)!,
          storyboard_rank: (index + 1) * 1024,
        })),
      );
    } catch {
      /* Preserve the authoritative order after a conflict. */
    }
  }
  const [chatOpen, setChatOpen] = useAtom(chatPanelOpenAtom);
  const active = graph?.nodes.find((node) => node.id === selected);
  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
          <Button asChild size="icon" variant="ghost">
            <Link to={`/platform/canvas/projects/${projectId}`} aria-label="返回项目">
              <ArrowLeft />
            </Link>
          </Button>
          <h1 className="flex-1 truncate font-medium">{graph?.canvas.name ?? "画布"}</h1>
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setLeftOpen(!leftOpen)}
            aria-label={leftOpen ? "收起节点面板" : "展开节点面板"}
          >
            {leftOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
          </Button>
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <Button
              size="sm"
              variant={view === "canvas" ? "secondary" : "ghost"}
              onClick={() => void changeView("canvas")}
            >
              <PanelsTopLeft className="size-4" />
              画布
            </Button>
            <Button
              size="sm"
              variant={view === "storyboard" ? "secondary" : "ghost"}
              onClick={() => void changeView("storyboard")}
            >
              <Film className="size-4" />
              故事板
            </Button>
          </div>
          <Button size="icon" variant="ghost" onClick={() => void refresh()} aria-label="刷新">
            <RefreshCw className="size-4" />
          </Button>
          <Button
            size="icon"
            variant={chatOpen ? "secondary" : "ghost"}
            onClick={() => setChatOpen(!chatOpen)}
            aria-label="对话"
          >
            <MessageSquare className="size-4" />
          </Button>
        </header>
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="canvas-workspace" minSize="40%">
            <div className="flex h-full min-h-0">
              {leftOpen ? (
                <StudioNodePanel
                  busy={busy || !graph}
                  selectedId={selected}
                  onCreate={(type) => void createNode(type)}
                  onSelect={(id) => void selectNode(id)}
                />
              ) : null}
              <main className="relative h-full min-w-0 flex-1">
                {!graph ? (
                  failed ? (
                    <Button className="m-6" onClick={() => void refresh()}>
                      加载失败，重试
                    </Button>
                  ) : (
                    <Skeleton className="h-full w-full" />
                  )
                ) : view === "storyboard" ? (
                  <Storyboard
                    selectedId={selected}
                    busy={busy}
                    onSelect={(id) => void selectNode(id)}
                    onAdd={() => void createNode(6)}
                    onMove={(id, direction) => void moveShot(id, direction)}
                  />
                ) : (
                  <CanvasBoard
                    busy={busy}
                    mutate={mutate}
                    onSelect={(id) => void selectNode(id)}
                    onDeleteSelection={setDeletion}
                  />
                )}
                {active ? (
                  <div className="absolute bottom-16 left-1/2 z-20 max-h-[70%] w-96 max-w-[90%] -translate-x-1/2 overflow-auto rounded-xl border bg-background shadow-lg">
                    <NodeEditor
                      ref={editor}
                      key={active.id}
                      node={active}
                      busy={busy}
                      onSave={(node) => mutate([node])}
                      onDelete={() => setDeletion({ nodes: [active.id], edges: [] })}
                    />
                    {active.type === 7 ? (
                      <NodeGeneration
                        key={`generation:${active.id}`}
                        canvasId={canvasId}
                        nodeId={active.id}
                        beforeStart={async () => {
                          await editor.current?.finish();
                        }}
                        onChange={refresh}
                      />
                    ) : null}
                  </div>
                ) : null}
              </main>
            </div>
          </ResizablePanel>
          {chatOpen ? (
            <>
              <ResizableHandle withHandle aria-label="调整画布会话宽度" />
              <ResizablePanel id="canvas-chat" defaultSize="400px" minSize="320px" maxSize="50%">
                <aside className="flex h-full min-h-0 flex-col bg-background" aria-label="画布会话">
                  <CanvasConversation canvasId={canvasId} onChange={() => void refresh()} />
                </aside>
              </ResizablePanel>
            </>
          ) : null}
        </ResizablePanelGroup>
        <DeleteSelectionDialog
          selection={deletion}
          busy={busy}
          onClose={() => setDeletion(null)}
          onConfirm={async () => {
            if (!deletion) return;
            const removed = new Set(deletion.nodes);
            const removedEdges = new Set(deletion.edges);
            if (!selected || !removed.has(selected)) await editor.current?.finish();
            await mutate(
              (current) =>
                current.nodes
                  .filter(
                    (node) => !removed.has(node.id) && node.incoming_edges.some((edge) => removedEdges.has(edge.id)),
                  )
                  .map((node) => ({
                    ...node,
                    incoming_edges: node.incoming_edges.filter((edge) => !removedEdges.has(edge.id)),
                  })),
              deletion.nodes,
            );
            if (selected && removed.has(selected)) setSelected(null);
            setDeletion(null);
          }}
        />
      </div>
    </TooltipProvider>
  );
}
