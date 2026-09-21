import {
  canvasStartStoryboard,
  canvasCancelStoryboard,
  canvasConfirmStoryboard,
  type CanvasStoryboardDraftInput,
  type CanvasStoryboardDraft,
  type CanvasStoryboardShot,
} from "@repo/api";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Badge } from "@repo/design-system";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { WandSparkles } from "lucide-react";
import { useRef, useState } from "react";

import { useStoryboardDrafts } from "../../hooks/useStoryboardDrafts";
import { canvasGraphAtom, applyGraphAtom } from "../../store/graph";
import { useStudioMutationCoordinator } from "../../store/mutations";
import type { NodeEditorHandle } from "../NodeEditor";
import { StoryboardDraftEditor } from "./StoryboardDraftEditor";
import { StoryboardForm } from "./StoryboardForm";

const labels: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  completed: "待确认",
  failed: "失败",
  cancelled: "已取消",
};
export function StoryboardDesigner({
  disabled,
  open,
  onOpenChange,
  beforeStart,
}: {
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  beforeStart: () => Promise<void>;
}) {
  const editor = useRef<NodeEditorHandle>(null);
  const graph = useAtomValue(canvasGraphAtom);
  const store = useStore();
  const apply = useSetAtom(applyGraphAtom);
  const coordinator = useStudioMutationCoordinator();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const { items, failed, streamFailed, refresh } = useStoryboardDrafts(graph?.canvas.id ?? "", open, selected);
  const draft = items.find((item) => item.id === selected);
  async function start(input: CanvasStoryboardDraftInput) {
    if (!graph) return;
    setBusy(true);
    try {
      await beforeStart();
      const result = await canvasStartStoryboard(graph.canvas.id, input);
      setSelected(result.id);
      refresh();
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function discard(item: CanvasStoryboardDraft) {
    if (!graph) return;
    setBusy(true);
    try {
      await canvasCancelStoryboard(graph.canvas.id, item.id);
      refresh();
      if (selected === item.id) setSelected(null);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function confirm(shots: CanvasStoryboardShot[]) {
    if (!graph || !draft) return;
    setBusy(true);
    try {
      await beforeStart();
      await coordinator.enqueue(async () => {
        const next = await canvasConfirmStoryboard(graph.canvas.id, draft.id, {
          expected_revision: store.get(canvasGraphAtom)!.canvas.revision,
          shots,
          video_config: draft.video_config,
        });
        apply(next);
      });
      setSelected(null);
      refresh();
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function changeSelection(id: string | null) {
    try {
      await editor.current?.finish();
      setSelected(id);
    } catch {
      /* Preserve unsaved draft. */
    }
  }
  async function changeOpen(next: boolean) {
    try {
      if (!next) await editor.current?.finish();
      onOpenChange(next);
    } catch {
      /* Preserve unsaved draft. */
    }
  }
  return (
    <>
      <Button variant="outline" disabled={disabled || !graph} onClick={() => onOpenChange(true)}>
        <WandSparkles className="size-4" />
        智能分镜
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) void changeOpen(next);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[1000px]">
          <DialogHeader>
            <DialogTitle>剧本设计与候选分镜</DialogTitle>
          </DialogHeader>
          <div className="flex gap-4">
            <aside className="w-40 shrink-0 space-y-2">
              <Button
                variant={selected ? "outline" : "secondary"}
                onClick={() => void changeSelection(null)}
                disabled={busy}
              >
                新建分镜草稿
              </Button>
              {failed ? <p className="text-sm text-destructive">草稿加载失败</p> : null}
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`w-full space-y-1 rounded border p-2 text-left ${selected === item.id ? "bg-muted" : ""}`}
                  disabled={busy}
                  onClick={() => void changeSelection(item.id)}
                >
                  <p className="truncate text-sm">{item.plot.slice(0, 30)}</p>
                  <Badge variant="secondary">{labels[item.status] ?? item.status}</Badge>
                </button>
              ))}
            </aside>
            <div className="min-w-0 flex-1">
              {draft ? (
                <div className="space-y-4">
                  <div className="flex justify-between">
                    <Badge>{labels[draft.status] ?? draft.status}</Badge>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void discard(draft)}>
                      {draft.status === "running" || draft.status === "queued" ? "停止并放弃" : "放弃草稿"}
                    </Button>
                  </div>
                  {streamFailed ? (
                    <p role="status" className="text-sm text-muted-foreground">
                      进度连接重试中，已生成分镜已保存。
                    </p>
                  ) : null}
                  {draft.error ? <p className="text-destructive">{draft.error}</p> : null}
                  {draft.status === "completed" || draft.shots.length > 0 ? (
                    <StoryboardDraftEditor
                      ref={editor}
                      canvasId={graph!.canvas.id}
                      key={draft.id}
                      draft={draft}
                      busy={busy || disabled}
                      onConfirm={confirm}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{draft.plot}</p>
                  )}
                </div>
              ) : (
                <StoryboardForm busy={busy} onSubmit={start} />
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
