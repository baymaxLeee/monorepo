import { canvasCancelGeneration, canvasStartGeneration } from "@repo/api";
import { useStore } from "jotai";
import { useRef, useState } from "react";

import { generationStatusAtom } from "../store/generations";
import { canvasGraphAtom } from "../store/graph";
import { useStudioMutationCoordinator } from "../store/mutations";

export function useNodeGenerationActions(
  canvasId: string,
  beforeStart: () => Promise<void>,
  refresh: () => Promise<void>,
) {
  const store = useStore();
  const coordinator = useStudioMutationCoordinator();
  const starts = useRef(new Map<string, Promise<string>>());
  const [workingId, setWorkingId] = useState<string | null>(null);
  async function start(nodeId: string) {
    if (starts.current.has(nodeId)) return;
    setWorkingId(nodeId);
    const request = (async () => {
      await beforeStart();
      return coordinator.enqueue(async () => {
        const node = store.get(canvasGraphAtom)?.nodes.find((item) => item.id === nodeId);
        if (!node) throw new Error("分镜已不存在");
        const run = await canvasStartGeneration(canvasId, nodeId, {
          operation_id: crypto.randomUUID(),
          expected_revision: node.revision,
        });
        store.set(generationStatusAtom, (current) =>
          new Map(current).set(nodeId, {
            id: run.id,
            node_id: nodeId,
            status: run.status,
            task_type: 1,
            cancel_requested: run.cancel_requested,
          }),
        );
        return run.id;
      });
    })();
    starts.current.set(nodeId, request);
    try {
      await request;
      await refresh();
    } finally {
      starts.current.delete(nodeId);
      setWorkingId((current) => (current === nodeId ? null : current));
    }
  }
  async function cancel(nodeId: string) {
    setWorkingId(nodeId);
    try {
      const pending = starts.current.get(nodeId);
      const runId = pending ? await pending : store.get(generationStatusAtom).get(nodeId)?.id;
      if (!runId) return;
      await coordinator.enqueue(async () => {
        const result = await canvasCancelGeneration(canvasId, runId);
        store.set(generationStatusAtom, (current) => {
          if (current.get(nodeId)?.id !== runId) return current;
          return new Map(current).set(nodeId, {
            id: runId,
            node_id: nodeId,
            status: result.status,
            task_type: 1,
            cancel_requested: result.cancel_requested,
          });
        });
      });
      await refresh();
    } finally {
      setWorkingId((current) => (current === nodeId ? null : current));
    }
  }
  return { start, cancel, workingId };
}
