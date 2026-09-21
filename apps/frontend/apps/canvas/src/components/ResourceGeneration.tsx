import {
  canvasCancelResourceGeneration,
  canvasGetResourceGeneration,
  canvasListResourceGenerationRuns,
  canvasStartResourceGeneration,
  canvasUpdateResourceGeneration,
  type CanvasResourceAsset,
  type CanvasResourceGenerationDraft,
  type CanvasGeneration,
} from "@repo/api";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Skeleton } from "@repo/design-system";
import { useEffect, useRef, useState } from "react";

import { ResourceGenerationForm } from "./ResourceGenerationForm";

export function ResourceGeneration({
  projectId,
  asset,
  siblings,
  onChange,
}: {
  projectId: string;
  asset: CanvasResourceAsset;
  siblings: CanvasResourceAsset[];
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CanvasResourceGenerationDraft | null>(null);
  const [runs, setRuns] = useState<CanvasGeneration[]>([]);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const change = useRef(onChange);
  change.current = onChange;
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let previous: string | undefined;
    const refresh = async () => {
      try {
        const [config, history] = await Promise.all([
          canvasGetResourceGeneration(projectId, asset.id, { signal: controller.signal }),
          canvasListResourceGenerationRuns(projectId, asset.id, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        setDraft(config);
        setRuns(history.items);
        setFailed(false);
        const signature = history.items.map((run) => `${run.id}:${run.status}`).join(",");
        if (previous !== undefined && previous !== signature) change.current();
        previous = signature;
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 3000);
    };
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [open, projectId, asset.id, reload]);
  const running = runs.find((run) => run.status === "queued" || run.status === "running");
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        生成设置
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{asset.name} · 图片生成</DialogTitle>
          </DialogHeader>
          {failed ? <p className="text-sm text-destructive">读取失败，正在重试</p> : null}
          {!draft ? (
            <Skeleton className="h-40" />
          ) : (
            <ResourceGenerationForm
              key={`${asset.id}:${draft.revision}`}
              draft={draft}
              busy={busy}
              running={Boolean(running)}
              references={siblings.filter((item) => item.id !== asset.id && item.has_content && item.media_type === 1)}
              onSave={async (config, start) => {
                setBusy(true);
                try {
                  const updated = await canvasUpdateResourceGeneration(projectId, asset.id, {
                    expected_revision: draft.revision,
                    config,
                  });
                  setDraft(updated);
                  if (start)
                    await canvasStartResourceGeneration(projectId, asset.id, {
                      expected_revision: updated.revision,
                      operation_id: crypto.randomUUID(),
                    });
                  setReload((value) => value + 1);
                  change.current();
                } catch {
                  /* The shared API client displays errors. */
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
          {running ? (
            <Button
              variant="destructive"
              disabled={busy || running.cancel_requested}
              onClick={() => {
                setBusy(true);
                void canvasCancelResourceGeneration(projectId, asset.id, running.id)
                  .then(() => setReload((value) => value + 1))
                  .catch(() => {})
                  .finally(() => setBusy(false));
              }}
            >
              {running.cancel_requested ? "正在停止…" : "停止生成"}
            </Button>
          ) : null}
          <div className="space-y-2">
            <p className="text-sm font-medium">生成记录</p>
            {runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">尚无生成记录</p>
            ) : (
              runs.map((run) => (
                <div key={run.id} className="rounded-md border p-2 text-sm">
                  <div className="flex justify-between">
                    <span>
                      {(
                        {
                          queued: "排队中",
                          running: "生成中",
                          completed: "已完成",
                          failed: "失败",
                          cancelled: "已取消",
                        } as Record<string, string>
                      )[run.status] ?? run.status}
                    </span>
                    <time>{new Date(run.created_at).toLocaleString()}</time>
                  </div>
                  {run.error ? <p className="text-destructive">{run.error}</p> : null}
                  {run.status === "completed" ? (
                    <p className="text-muted-foreground">已保存至素材版本，可在版本记录中预览和选用。</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
