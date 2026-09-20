import {
  canvasStartGeneration,
  canvasListGenerations,
  canvasCancelGeneration,
  canvasApplyGeneration,
  type CanvasGeneration,
} from "@repo/api";
import { Button, Badge } from "@repo/design-system";
import { useStore } from "jotai";
import { useEffect, useState } from "react";

import { applyGraphAtom, canvasGraphAtom } from "../store/graph";
import { useStudioMutationCoordinator } from "../store/mutations";

const labels: Record<string, string> = {
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
export function NodeGeneration({
  canvasId,
  nodeId,
  beforeStart,
  onChange,
}: {
  canvasId: string;
  nodeId: string;
  beforeStart: () => Promise<void>;
  onChange: () => Promise<void>;
}) {
  const store = useStore();
  const coordinator = useStudioMutationCoordinator();
  const [items, setItems] = useState<CanvasGeneration[]>([]);
  const [working, setWorking] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    let previous = "";
    async function refresh() {
      try {
        const result = await canvasListGenerations(canvasId, nodeId, {
          signal: controller.signal,
          skipErrorNotify: true,
        });
        if (disposed) return;
        setItems(result.items);
        setFailed(false);
        const signature = result.items.map((item) => `${item.id}:${item.status}`).join();
        if (previous && previous !== signature) await onChange();
        previous = signature;
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
  }, [canvasId, nodeId, reload, onChange]);
  const active = items.some((item) => item.status === "queued" || item.status === "running");
  async function run(action: () => Promise<unknown>) {
    setWorking(true);
    try {
      await action();
      setReload((value) => value + 1);
      await onChange();
    } catch {
      /* Requests report their errors through the shared API client. */
    } finally {
      setWorking(false);
    }
  }
  return (
    <section className="space-y-3 border-t p-4">
      <Button
        disabled={working || active}
        onClick={() =>
          void run(async () => {
            await beforeStart();
            await coordinator.enqueue(async () => {
              const node = store.get(canvasGraphAtom)?.nodes.find((value) => value.id === nodeId);
              if (!node) return;
              await canvasStartGeneration(canvasId, nodeId, {
                operation_id: crypto.randomUUID(),
                expected_revision: node.revision,
              });
            });
          })
        }
      >
        {active ? "生成中…" : "生成文本"}
      </Button>
      {failed ? (
        <p role="alert" className="text-sm text-destructive">
          生成记录加载失败，正在重试。
        </p>
      ) : null}
      {items.length ? <h3 className="text-sm font-medium">生成历史</h3> : null}
      {items.map((item) => (
        <div key={item.id} className="space-y-2 rounded-lg border p-3 text-sm">
          <div className="flex items-center justify-between">
            <Badge variant="secondary">{labels[item.status] ?? item.status}</Badge>
            <time>{new Date(item.created_at).toLocaleString()}</time>
          </div>
          {item.error ? <p className="text-destructive">{item.error}</p> : null}
          {item.output_text ? (
            <details>
              <summary className="cursor-pointer">查看结果{item.applied ? " · 已自动写入" : ""}</summary>
              <p className="max-h-60 overflow-auto whitespace-pre-wrap py-2">{item.output_text}</p>
            </details>
          ) : null}
          {item.status === "completed" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={working || active}
              onClick={() =>
                void run(async () => {
                  await beforeStart();
                  await coordinator.enqueue(async () => {
                    const node = store.get(canvasGraphAtom)?.nodes.find((value) => value.id === nodeId);
                    if (node)
                      store.set(
                        applyGraphAtom,
                        await canvasApplyGeneration(canvasId, item.id, { expected_revision: node.revision }),
                      );
                  });
                })
              }
            >
              使用此版本
            </Button>
          ) : null}
          {item.status === "queued" || item.status === "running" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={working || item.cancel_requested}
              onClick={() => void run(() => canvasCancelGeneration(canvasId, item.id))}
            >
              {item.cancel_requested ? "正在取消" : "停止生成"}
            </Button>
          ) : null}
        </div>
      ))}
    </section>
  );
}
