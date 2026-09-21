import {
  canvasCreateArchive,
  canvasListArchives,
  canvasCancelArchive,
  canvasArchiveContent,
  type CanvasArchive,
} from "@repo/api";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Badge, toast } from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { Download, History, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

const labels: Record<string, string> = {
  queued: "排队中",
  running: "导出中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
export function CanvasArchives({
  canvasId,
  beforeStart,
  disabled,
}: {
  canvasId: string;
  beforeStart: () => Promise<void>;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CanvasArchive[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const result = await canvasListArchives(canvasId, { signal: controller.signal, skipErrorNotify: true });
        if (!disposed) {
          setItems(result.items);
          setFailed(false);
        }
      } catch {
        if (!disposed) setFailed(true);
      }
      if (!disposed) timer = setTimeout(refresh, 3000);
    }
    void refresh();
    return () => {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [canvasId, open, reload]);
  async function start() {
    setBusy(true);
    try {
      await beforeStart();
      await canvasCreateArchive(canvasId);
      setOpen(true);
      setReload((value) => value + 1);
    } catch {
      /* The API interceptor reports errors. */
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id: string) {
    try {
      await canvasCancelArchive(canvasId, id);
      setReload((value) => value + 1);
    } catch {
      /* The API interceptor reports errors. */
    }
  }
  async function download(item: CanvasArchive) {
    try {
      const url = URL.createObjectURL(await canvasArchiveContent(canvasId, item.id));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = item.filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast.error(getErrorMessage(error, "下载失败"));
    }
  }
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <History className="size-4" />
        导出记录
      </Button>
      <Button size="sm" variant="outline" disabled={disabled || busy} onClick={() => void start()}>
        {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}批量导出
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>导出记录</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            按故事板顺序打包已选中的生成视频，包含 FCPXML 时间线。下载有效期为七天。
          </p>
          {failed && <p className="text-sm text-destructive">记录加载失败，正在重试</p>}
          {!failed && items.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">暂无导出记录</p>
          )}
          <div className="max-h-96 space-y-3 overflow-auto">
            {items.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.filename}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(item.created_at).toLocaleString()} · {item.input_count} 个视频
                  </p>
                  {item.error && <p className="text-xs text-destructive">{item.error}</p>}
                </div>
                <Badge variant="secondary">{labels[item.status] ?? item.status}</Badge>
                {item.downloadable && (
                  <Button size="sm" onClick={() => void download(item)}>
                    下载
                  </Button>
                )}
                {["queued", "running"].includes(item.status) && (
                  <Button size="sm" variant="ghost" onClick={() => void cancel(item.id)}>
                    取消
                  </Button>
                )}
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
