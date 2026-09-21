import type { CanvasNode } from "@repo/api";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from "@repo/design-system";
import { useAtomValue, useStore } from "jotai";
import { Plus } from "lucide-react";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";

import emptyIllustration from "../assets/storyboard-empty.png";
import { useAssetMatching } from "../hooks/useAssetMatching";
import { useNodeGenerationActions } from "../hooks/useNodeGenerationActions";
import { generationStatusAtom } from "../store/generations";
import { canvasGraphAtom, storyboardNodesAtom } from "../store/graph";
import type { NodeEditorHandle } from "./NodeEditor";
import { NodeGeneration } from "./NodeGeneration";
import { PreviewPanel } from "./storyboard/PreviewPanel";
import { ShotEditor } from "./storyboard/ShotEditor";
import { ShotTimeline } from "./storyboard/ShotTimeline";
import { StoryboardDesigner } from "./storyboard/StoryboardDesigner";

export const Storyboard = forwardRef<
  NodeEditorHandle,
  {
    selectedId: string | null;
    projectId: string;
    busy: boolean;
    onSelect: (id: string) => Promise<void>;
    onAdd: (index?: number) => void;
    onReorder: (ids: string[]) => void;
    onRemove: (id: string) => void;
    onSave: (node: CanvasNode) => Promise<void>;
    onRefresh: () => Promise<void>;
  }
>(function Storyboard({ projectId, selectedId, busy, onSelect, onAdd, onReorder, onRemove, onSave, onRefresh }, ref) {
  const shots = useAtomValue(storyboardNodesAtom);
  const store = useStore();
  const graph = useAtomValue(canvasGraphAtom);
  const statuses = useAtomValue(generationStatusAtom);
  const editor = useRef<NodeEditorHandle>(null);
  const [history, setHistory] = useState(false);
  const [designer, setDesigner] = useState(false);
  const [playback, setPlayback] = useState<{ id: string; playing: boolean; all: boolean } | null>(null);
  const selected = shots.find((node) => node.id === selectedId) ?? shots[0];
  const matching = useAssetMatching({
    canvasId: graph?.canvas.id ?? "",
    nodeId: selected?.id ?? "",
    onApplied: onRefresh,
  });
  const preview = shots.find((node) => node.id === playback?.id) ?? selected;
  const playable = shots.filter(
    (node) => node.asset_id && !["queued", "running"].includes(statuses.get(node.id)?.status ?? ""),
  );
  const next = playable[playable.findIndex((node) => node.id === preview?.id) + 1];
  const finish = async () => {
    await editor.current?.finish();
  };
  useImperativeHandle(ref, () => ({ finish }));
  const actions = useNodeGenerationActions(graph?.canvas.id ?? "", finish, onRefresh);
  if (!graph) return null;
  const state = statuses.get(selected?.id ?? "");
  const locked = state?.status === "queued" || state?.status === "running";
  async function select(id: string) {
    try {
      await finish();
      await onSelect(id);
      setPlayback(null);
    } catch {
      /* Keep unsaved edits. */
    }
  }
  async function playAll() {
    try {
      await finish();
      if (playable[0]) setPlayback({ id: playable[0].id, playing: true, all: true });
    } catch {
      /* Keep unsaved edits. */
    }
  }
  return (
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      <div className="flex min-h-0 flex-1">
        {selected ? (
          <ShotEditor
            ref={editor}
            key={selected.id}
            node={selected}
            projectId={projectId}
            canvasId={graph.canvas.id}
            index={shots.indexOf(selected)}
            busy={busy}
            locked={locked || matching.matching}
            onSave={onSave}
            matching={matching.matching}
            cancelling={matching.cancelling}
            matchError={matching.error}
            onMatch={() => {
              void matching.start(async () => {
                await finish();
                return (
                  store.get(canvasGraphAtom)?.nodes.find((node) => node.id === selected.id)?.revision ??
                  selected.revision
                );
              });
            }}
            onCancelMatch={() => void matching.cancel()}
          />
        ) : (
          <section className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-8 py-3 pl-5 pr-3">
            <img alt="" className="h-[280px] w-[300px] object-contain" src={emptyIllustration} />
            <div className="flex items-center gap-3">
              <Button variant="outline" disabled={busy} onClick={() => setDesigner(true)}>
                批量创建分镜
              </Button>
              <Button disabled={busy} onClick={() => onAdd()}>
                <Plus className="size-4" />
                创建分镜
              </Button>
            </div>
          </section>
        )}
        <PreviewPanel
          canvasId={graph.canvas.id}
          shot={preview}
          nextShot={playback?.all ? next : undefined}
          playing={Boolean(playback?.playing)}
          canPlayAll={playable.length > 0 && !busy}
          working={Boolean(actions.workingId)}
          onPause={() => setPlayback((current) => (current ? { ...current, playing: false } : null))}
          onPlay={() => {
            if (preview) setPlayback((current) => ({ id: preview.id, playing: true, all: current?.all ?? false }));
          }}
          onPlayAll={() => void playAll()}
          onEnded={() =>
            setPlayback((current) =>
              current?.all && next
                ? { ...current, id: next.id, playing: true }
                : current
                  ? { ...current, playing: false }
                  : null,
            )
          }
          onGenerate={() => {
            if (preview) void actions.start(preview.id).catch(() => {});
          }}
          onCancel={() => {
            if (preview) void actions.cancel(preview.id).catch(() => {});
          }}
          onHistory={() => setHistory(true)}
        />
      </div>
      <div className="flex items-center justify-between px-5 py-2 text-xs text-muted-foreground">
        <span>
          {shots.length} 个分镜 ·{" "}
          {shots.reduce((sum, node) => sum + Math.max(0, node.generation_config.duration_seconds), 0)} 秒
        </span>
        <StoryboardDesigner disabled={busy} open={designer} onOpenChange={setDesigner} beforeStart={finish} />
      </div>
      <ShotTimeline
        canvasId={graph.canvas.id}
        shots={shots}
        selectedId={selected?.id ?? null}
        playingId={playback?.playing ? playback.id : null}
        busy={busy}
        onSelect={(id) => void select(id)}
        onAdd={onAdd}
        onBatch={() => setDesigner(true)}
        onRemove={onRemove}
        onReorder={onReorder}
      />
      <Dialog open={history} onOpenChange={setHistory}>
        <DialogContent className="max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>分镜生成记录</DialogTitle>
          </DialogHeader>
          {history && preview ? (
            <NodeGeneration
              key={preview.id}
              canvasId={graph.canvas.id}
              nodeId={preview.id}
              type={6}
              beforeStart={finish}
              onChange={onRefresh}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
});
