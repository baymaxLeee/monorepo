import { type createStore, type Atom, atom, useAtomValue } from "jotai";
import { useRef } from "react";

import type { canvasnode } from "@/domain";

import { canvasGraphAtom, patchCanvasNodeAtom } from "../../store";

/**
 * Canvas 卡片的按 NodeID 订阅门面。它只访问页面级 Canvas Store，
 * 不保存第二份节点或生成状态。
 */
export class CanvasNodeStore {
  private readonly nodeAtoms = new Map<string, Atom<canvasnode.CanvasNode | undefined>>();
  readonly targetsAtom = atom((get) =>
    get(canvasGraphAtom).nodeIds.flatMap((NodeID) => {
      const node = get(canvasGraphAtom).nodesById.get(NodeID);
      return node?.ActiveTaskRunID ? [{ NodeID, TaskRunID: node.ActiveTaskRunID, TaskType: node.ActiveTaskType }] : [];
    }),
  );

  constructor(readonly store: ReturnType<typeof createStore>) {}

  getAtom(nodeId: string) {
    let nodeAtom = this.nodeAtoms.get(nodeId);
    if (!nodeAtom) {
      nodeAtom = atom((get) => get(canvasGraphAtom).nodesById.get(nodeId));
      this.nodeAtoms.set(nodeId, nodeAtom);
    }
    return nodeAtom;
  }

  getNodes() {
    const graph = this.store.get(canvasGraphAtom);
    return graph.nodeIds.flatMap((nodeId) => {
      const node = graph.nodesById.get(nodeId);
      return node ? [node] : [];
    });
  }

  /** 删除已离开画布的节点 atom，避免长时间创建、删除节点时缓存单调增长。 */
  retain(nodeIds: Iterable<string>) {
    const retained = new Set(nodeIds);
    for (const nodeId of this.nodeAtoms.keys()) {
      if (!retained.has(nodeId)) this.nodeAtoms.delete(nodeId);
    }
  }

  update(nodeId: string, update: (current: canvasnode.CanvasNode) => canvasnode.CanvasNode) {
    const current = this.store.get(canvasGraphAtom).nodesById.get(nodeId);
    if (!current) return;
    this.store.set(patchCanvasNodeAtom, {
      nodeId,
      patch: update(current),
    });
  }
}

export function useCanvasNodeSnapshot(store: CanvasNodeStore, fallback: canvasnode.CanvasNode, enabled = true) {
  const node = useAtomValue(store.getAtom(fallback.NodeID), {
    store: store.store,
  });
  return enabled ? (node ?? fallback) : fallback;
}

export function useCanvasGenerationTargets(store: CanvasNodeStore) {
  const targets = useAtomValue(store.targetsAtom, { store: store.store });
  const stableTargets = useRef(targets);
  const unchanged =
    stableTargets.current.length === targets.length &&
    stableTargets.current.every(
      (target, index) =>
        target.NodeID === targets[index]?.NodeID &&
        target.TaskRunID === targets[index]?.TaskRunID &&
        target.TaskType === targets[index]?.TaskType,
    );

  // Polling responses update node result projections, which recomputes the
  // derived atom with a fresh array. Keep the reference stable so that those
  // projection-only updates cannot restart the effect and bypass its 3s delay.
  if (!unchanged) stableTargets.current = targets;
  return stableTargets.current;
}
