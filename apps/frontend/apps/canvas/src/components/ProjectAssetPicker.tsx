import {
  canvasSearchCreativeAssets,
  canvasCopyAsset,
  canvasNodeFrames,
  type CanvasCreativeAsset,
  type CanvasNode,
} from "@repo/api";
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, Badge } from "@repo/design-system";
import { useStore } from "jotai";
import { useEffect, useState } from "react";

import { applyGraphAtom, canvasGraphAtom } from "../store/graph";
import { useStudioMutationCoordinator } from "../store/mutations";

export function ProjectAssetPicker({
  disabled,
  onReference,
  onFrame,
}: {
  disabled: boolean;
  onReference?: (node: CanvasNode) => void;
  onFrame?: (node: CanvasNode, side: "first" | "last") => void;
}) {
  const store = useStore();
  const coordinator = useStudioMutationCoordinator();
  const graph = store.get(canvasGraphAtom);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CanvasCreativeAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || !graph) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void canvasSearchCreativeAssets(graph.canvas.project_id, {
        params: { query, limit: 100 },
        signal: controller.signal,
        skipErrorNotify: true,
      })
        .then((result) => {
          if (!controller.signal.aborted) {
            setItems(result.items);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(true);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, query, graph?.canvas.id]);
  async function choose(assetId: string, side?: "first" | "last") {
    setBusy(true);
    try {
      await coordinator.enqueue(async () => {
        const current = store.get(canvasGraphAtom);
        if (!current) return;
        const existing = current.nodes.find((node) => node.asset_id === assetId);
        if (existing) {
          if (side && onFrame) onFrame(existing, side);
          else onReference?.(existing);
          setOpen(false);
          return;
        }
        const id = crypto.randomUUID();
        const result = await canvasCopyAsset(current.canvas.id, {
          asset_id: assetId,
          node_id: id,
          expected_revision: current.canvas.revision,
          x: 0,
          y: 0,
        });
        store.set(applyGraphAtom, result);
        const node = result.nodes.find((item) => item.id === id);
        if (node) {
          if (side && onFrame) onFrame(node, side);
          else onReference?.(node);
        }
        setOpen(false);
      });
    } catch {
    } finally {
      setBusy(false);
    }
  }
  async function frame(item: CanvasCreativeAsset, side: "first" | "last") {
    setBusy(true);
    try {
      const result = await canvasNodeFrames(item.canvas_id, item.node_id);
      const id = side === "first" ? result.first_asset_id : result.last_asset_id;
      if (id) await choose(id, side);
      else setFailed(true);
    } catch {
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
        选择项目素材
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>项目素材与生成产物</DialogTitle>
          </DialogHeader>
          <Input
            aria-label="搜索项目素材"
            placeholder="输入名称搜索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {failed ? <p className="text-sm text-destructive">素材读取失败，或视频首尾帧尚不可用</p> : null}
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {items.map((item, index) => (
              <div key={`${item.current_asset_id}:${index}`} className="flex items-center gap-2 rounded border p-2">
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
                <Badge variant="secondary">{item.resource_asset_id ? "资源库" : "画布"}</Badge>
                <Button type="button" size="sm" disabled={busy} onClick={() => void choose(item.current_asset_id)}>
                  选用
                </Button>
                {item.media_type === 2 && item.node_id ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void frame(item, "first")}
                    >
                      首帧
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void frame(item, "last")}
                    >
                      尾帧
                    </Button>
                  </>
                ) : null}
              </div>
            ))}
            {!items.length ? <p className="text-sm text-muted-foreground">暂无匹配素材</p> : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
