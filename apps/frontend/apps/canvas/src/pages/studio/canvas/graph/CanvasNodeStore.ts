import { type createStore, atom, useAtomValue } from "jotai";
import { useCallback, useRef, useSyncExternalStore } from "react";

import type { canvasnode } from "@/domain";
import { PubSub } from "@/lib/pubsub";

import type { CanvasGenerationRuntimeState } from "../../domain/generationCancellation";
import type { CanvasGenerationFailure } from "../../domain/types";
import {
  canvasGenerationFailuresAtom,
  canvasGenerationRuntimeStatesAtom,
  canvasGraphAtom,
  patchCanvasNodeAtom,
} from "../../store";

export type CanvasNodeSnapshot = {
  node?: canvasnode.CanvasNode;
  failure?: CanvasGenerationFailure;
  runtimeState?: CanvasGenerationRuntimeState;
};

/** 页面级订阅桥接：正式数据仍在 Jotai Store，事件仅按 NodeID 通知变化。 */
export class CanvasNodeStore {
  private readonly events = new PubSub<Record<string, void>>();
  private readonly listeners = new Map<string, number>();
  private readonly snapshots = new Map<string, CanvasNodeSnapshot>();
  private unsubscribes: Array<() => void> = [];

  readonly targetsAtom = atom((get) =>
    get(canvasGraphAtom).nodeIds.flatMap((NodeID) => {
      const node = get(canvasGraphAtom).nodesById.get(NodeID);
      return node?.ActiveTaskRunID ? [{ NodeID, TaskRunID: node.ActiveTaskRunID, TaskType: node.ActiveTaskType }] : [];
    }),
  );

  constructor(readonly store: ReturnType<typeof createStore>) {}

  getSnapshot = (nodeId: string): CanvasNodeSnapshot => {
    const node = this.store.get(canvasGraphAtom).nodesById.get(nodeId);
    const failure = this.store.get(canvasGenerationFailuresAtom).get(nodeId);
    const runtimeState = this.store.get(canvasGenerationRuntimeStatesAtom).get(nodeId);
    const previous = this.snapshots.get(nodeId);
    if (previous && previous.node === node && previous.failure === failure && previous.runtimeState === runtimeState) {
      return previous;
    }
    const snapshot = { node, failure, runtimeState };
    this.snapshots.set(nodeId, snapshot);
    return snapshot;
  };

  subscribe = (nodeId: string, listener: () => void) => {
    const unsubscribe = this.events.on(nodeId, listener);
    this.listeners.set(nodeId, (this.listeners.get(nodeId) ?? 0) + 1);
    if (this.unsubscribes.length === 0) {
      const sync = () => {
        for (const id of this.listeners.keys()) {
          const previous = this.snapshots.get(id);
          if (this.getSnapshot(id) !== previous) this.events.emit(id);
        }
      };
      this.unsubscribes = [
        this.store.sub(canvasGraphAtom, sync),
        this.store.sub(canvasGenerationFailuresAtom, sync),
        this.store.sub(canvasGenerationRuntimeStatesAtom, sync),
      ];
    }
    const previous = this.snapshots.get(nodeId);
    if (previous && this.getSnapshot(nodeId) !== previous) listener();
    return () => {
      unsubscribe();
      const count = this.listeners.get(nodeId);
      if (count === 1) {
        this.listeners.delete(nodeId);
        this.snapshots.delete(nodeId);
      } else if (count !== undefined) {
        this.listeners.set(nodeId, count - 1);
      }
      if (this.listeners.size === 0) {
        for (const stop of this.unsubscribes) stop();
        this.unsubscribes = [];
      }
    };
  };

  clear() {
    for (const stop of this.unsubscribes) stop();
    this.unsubscribes = [];
    this.listeners.clear();
    this.snapshots.clear();
    this.events.clear();
  }

  getNodes() {
    const graph = this.store.get(canvasGraphAtom);
    return graph.nodeIds.flatMap((nodeId) => {
      const node = graph.nodesById.get(nodeId);
      return node ? [node] : [];
    });
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

export function useCanvasNodeSnapshot(store: CanvasNodeStore, nodeId: string) {
  const subscribe = useCallback((listener: () => void) => store.subscribe(nodeId, listener), [store, nodeId]);
  const getSnapshot = useCallback(() => store.getSnapshot(nodeId), [store, nodeId]);
  return useSyncExternalStore(subscribe, getSnapshot);
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
