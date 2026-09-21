import {
  canvasCancelAssetMatch,
  canvasGetAssetMatch,
  canvasLatestAssetMatch,
  canvasStartAssetMatch,
  type CanvasAssetMatchRun,
} from "@repo/api";
import { getErrorMessage } from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";

const active = (run?: CanvasAssetMatchRun | null) => run?.status === "queued" || run?.status === "running";

export function useAssetMatching({
  canvasId,
  nodeId,
  onApplied,
}: {
  canvasId: string;
  nodeId: string;
  onApplied: () => Promise<void>;
}) {
  const [run, setRun] = useState<CanvasAssetMatchRun | null>(null);
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const refreshed = useRef("");
  const operationId = useRef("");
  const runningId = run && active(run) ? run.id : "";
  const accept = useCallback(
    async (next: CanvasAssetMatchRun) => {
      setRun(next);
      setError(next.error);
      if (next.applied && refreshed.current !== next.id) {
        refreshed.current = next.id;
        await onApplied();
      }
    },
    [onApplied],
  );
  useEffect(() => {
    if (!canvasId || !nodeId) return;
    let closed = false;
    void canvasLatestAssetMatch(canvasId, nodeId, { skipErrorNotify: true })
      .then((next) => {
        if (!closed) void accept(next);
      })
      .catch(() => {});
    return () => {
      closed = true;
    };
  }, [accept, canvasId, nodeId]);
  useEffect(() => {
    if (!runningId) return;
    let closed = false;
    const poll = async () => {
      try {
        const next = await canvasGetAssetMatch(canvasId, nodeId, runningId, { skipErrorNotify: true });
        if (!closed) await accept(next);
      } catch (cause) {
        if (!closed) setError(getErrorMessage(cause, "素材匹配状态读取失败"));
      }
    };
    const timer = window.setInterval(() => void poll(), 1000);
    void poll();
    return () => {
      closed = true;
      window.clearInterval(timer);
    };
  }, [accept, canvasId, nodeId, runningId]);
  return {
    matching: starting || active(run),
    cancelling,
    error,
    async start(prepare: () => Promise<number>) {
      if (!canvasId || !nodeId || starting || active(run)) return;
      setStarting(true);
      setError("");
      try {
        const expectedRevision = await prepare();
        operationId.current ||= crypto.randomUUID();
        await accept(
          await canvasStartAssetMatch(canvasId, nodeId, {
            operation_id: operationId.current,
            expected_revision: expectedRevision,
          }),
        );
        operationId.current = "";
      } catch (cause) {
        setError(getErrorMessage(cause, "素材匹配启动失败"));
      } finally {
        setStarting(false);
      }
    },
    async cancel() {
      if (!run || !active(run) || cancelling) return;
      setCancelling(true);
      try {
        await accept(await canvasCancelAssetMatch(canvasId, nodeId, run.id));
      } catch (cause) {
        setError(getErrorMessage(cause, "取消素材匹配失败"));
      } finally {
        setCancelling(false);
      }
    },
  };
}
