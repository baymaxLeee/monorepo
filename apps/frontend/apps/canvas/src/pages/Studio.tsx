import {
  Button,
  Skeleton,
  TooltipProvider,
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@repo/design-system";
import { Provider, useAtom, useAtomValue } from "jotai";
import { useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { CanvasBoard } from "../components/CanvasBoard";
import { CanvasConversation } from "../components/CanvasConversation";
import { DeleteSelectionDialog, type CanvasSelection } from "../components/DeleteSelectionDialog";
import { NodeEditor, type NodeEditorHandle } from "../components/NodeEditor";
import { NodeGeneration } from "../components/NodeGeneration";
import { Storyboard } from "../components/Storyboard";
import { StudioSidebar } from "../components/StudioSidebar";
import { StudioToolbar } from "../components/StudioToolbar";
import { useCanvasGenerations } from "../hooks/useCanvasGenerations";
import { useCanvasGraph } from "../hooks/useCanvasGraph";
import { useStudioNodeActions } from "../hooks/useStudioNodeActions";
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
  useCanvasGenerations(canvasId, refresh);
  const [selected, setSelected] = useAtom(activeNodeIdAtom);
  const [deletion, setDeletion] = useState<CanvasSelection | null>(null);
  const editor = useRef<NodeEditorHandle>(null);
  const navigation = useRef(0);
  const leftOpen = useAtomValue(nodePanelOpenAtom);
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
  const { createNode, reorderShots } = useStudioNodeActions(projectId, graph, mutate, editor, setSelected);
  const chatOpen = useAtomValue(chatPanelOpenAtom);
  const active = graph?.nodes.find((node) => node.id === selected);
  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background">
        <StudioToolbar
          projectId={projectId}
          canvasId={canvasId}
          busy={busy}
          beforeStart={async () => {
            await editor.current?.finish();
          }}
          onRefresh={refresh}
          onViewChange={changeView}
        />
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel id="canvas-workspace" minSize="40%">
            <div className="flex h-full min-h-0">
              {leftOpen ? (
                <StudioSidebar
                  projectId={projectId}
                  canvasId={canvasId}
                  beforeCopy={async () => {
                    await editor.current?.finish();
                  }}
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
                ) : (
                  <>
                    <div
                      aria-hidden={view !== "canvas"}
                      className={`absolute inset-0 ${view !== "canvas" ? "invisible pointer-events-none" : ""}`}
                    >
                      <CanvasBoard
                        busy={busy}
                        mutate={mutate}
                        onSelect={(id) => void selectNode(id)}
                        onDeleteSelection={setDeletion}
                      />
                    </div>
                    {view === "storyboard" ? (
                      <Storyboard
                        ref={editor}
                        projectId={projectId}
                        selectedId={selected}
                        busy={busy}
                        onSelect={selectNode}
                        onAdd={(index) => void createNode(6, index)}
                        onReorder={(ids) => void reorderShots(ids)}
                        onRemove={(id) => setDeletion({ nodes: [id], edges: [] })}
                        onSave={(node) => mutate([node])}
                        onRefresh={refresh}
                      />
                    ) : null}
                  </>
                )}
                {active && view === "canvas" ? (
                  <div className="absolute bottom-16 left-1/2 z-20 max-h-[70%] w-96 max-w-[90%] -translate-x-1/2 overflow-auto rounded-xl border bg-background shadow-lg">
                    <NodeEditor
                      ref={editor}
                      key={active.id}
                      projectId={projectId}
                      canvasId={canvasId}
                      node={active}
                      busy={busy}
                      onRefresh={refresh}
                      onSave={(node) => mutate([node])}
                      onDelete={() => setDeletion({ nodes: [active.id], edges: [] })}
                    />
                    {active.type >= 5 && active.type <= 7 ? (
                      <NodeGeneration
                        key={`generation:${active.id}`}
                        canvasId={canvasId}
                        nodeId={active.id}
                        type={active.type}
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
