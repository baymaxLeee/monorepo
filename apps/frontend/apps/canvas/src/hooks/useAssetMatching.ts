import {
  canvasCancelAssetMatch,
  canvasGetAssetMatch,
  canvasStartAssetMatch,
  type CanvasAssetMatchRun,
} from "@repo/api";
import { getErrorMessage } from "@repo/shared";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { generationStatusAtom } from "../store/generations";

const active = (status?: string) => status === "queued" || status === "running";

/**
 * 旧版工作区外壳仍消费原始 Canvas DTO；状态同样来自画布级任务投影，
 * 不再通过一个“最近匹配记录”接口猜测节点是否正在匹配。
 */
export function useAssetMatching({
  canvasId,
  nodeId,
  onApplied,
}: {
  canvasId: string;
  nodeId: string;
  onApplied: () => Promise<void>;
}) {
  const states = useAtomValue(generationStatusAtom);
  const setStates = useSetAtom(generationStatusAtom);
  const state = states.get(nodeId);
  const runId = state?.task_type === 2 && active(state.status) ? state.id : "";
  const [starting, setStarting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const operationId = useRef("");
  const applied = useRef("");

  const project = useCallback(
    async (run: CanvasAssetMatchRun) => {
      setError(run.error);
      setStates((current) => {
        const next = new Map(current);
        next.set(nodeId, {
          id: run.id,
          node_id: nodeId,
          status: run.status,
          task_type: 2,
          cancel_requested: run.cancel_requested,
        });
        return next;
      });
      if (run.applied && applied.current !== run.id) {
        applied.current = run.id;
        await onApplied();
      }
    },
    [nodeId, onApplied, setStates],
  );

  useEffect(() => {
    if (!canvasId || !nodeId || !runId) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const run = await canvasGetAssetMatch(canvasId, nodeId, runId, { skipErrorNotify: true });
        if (!disposed) await project(run);
        if (!disposed && active(run.status)) timer = window.setTimeout(poll, 1000);
      } catch (cause) {
        if (!disposed) setError(getErrorMessage(cause, "素材匹配状态读取失败"));
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [canvasId, nodeId, project, runId]);

  return {
    matching: starting || Boolean(runId),
    cancelling,
    error,
    async start(prepare: () => Promise<number>) {
      if (!canvasId || !nodeId || starting || runId) return false;
      setStarting(true);
      setError("");
      try {
        const expectedRevision = await prepare();
        operationId.current ||= crypto.randomUUID();
        await project(
          await canvasStartAssetMatch(canvasId, nodeId, {
            operation_id: operationId.current,
            expected_revision: expectedRevision,
          }),
        );
        operationId.current = "";
        return true;
      } catch (cause) {
        setError(getErrorMessage(cause, "素材匹配启动失败"));
        return false;
      } finally {
        setStarting(false);
      }
    },
    async cancel() {
      if (!runId || cancelling) return;
      setCancelling(true);
      try {
        await project(await canvasCancelAssetMatch(canvasId, nodeId, runId));
      } catch (cause) {
        setError(getErrorMessage(cause, "取消素材匹配失败"));
      } finally {
        setCancelling(false);
      }
    },
  };
}
