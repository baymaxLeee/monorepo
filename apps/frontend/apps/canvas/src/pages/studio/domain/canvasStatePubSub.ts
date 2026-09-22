import type { canvasnode } from "@/domain";
import { PubSub } from "@/lib/pubsub";

export interface CanvasStateSnapshot {
  Items: canvasnode.CanvasNodeState[];
  Targets: Array<{ NodeID: string; TaskRunID: string; TaskType?: canvasnode.CanvasNodeTaskType }>;
  RefreshVersion: number;
}

export type CanvasStateControlEvent =
  | {
      type: "watch-target" | "unwatch-target";
      target: { NodeID: string; TaskRunID: string; TaskType?: canvasnode.CanvasNodeTaskType };
    }
  | { type: "refresh"; version: number };

type CanvasStateEvents = {
  snapshot: CanvasStateSnapshot;
  error: unknown;
  control: CanvasStateControlEvent;
};

export type CanvasStatePubSub = PubSub<CanvasStateEvents>;
const refreshVersions = new WeakMap<CanvasStatePubSub, number>();

export function createCanvasStatePubSub(): CanvasStatePubSub {
  return new PubSub<CanvasStateEvents>();
}

export function requestCanvasState(pubSub: CanvasStatePubSub) {
  const version = (refreshVersions.get(pubSub) ?? 0) + 1;
  refreshVersions.set(pubSub, version);
  return new Promise<CanvasStateSnapshot>((resolve, reject) => {
    const cleanup = () => {
      unsubscribeSnapshot();
      unsubscribeError();
    };
    const unsubscribeSnapshot = pubSub.on("snapshot", (snapshot) => {
      if (snapshot.RefreshVersion < version) return;
      cleanup();
      resolve(snapshot);
    });
    const unsubscribeError = pubSub.once("error", (error) => {
      cleanup();
      reject(error);
    });
    pubSub.emit("control", { type: "refresh", version });
  });
}

export function watchCanvasTarget(
  pubSub: CanvasStatePubSub,
  target: { NodeID: string; TaskRunID: string; TaskType?: canvasnode.CanvasNodeTaskType },
) {
  pubSub.emit("control", { type: "watch-target", target });
  return () => pubSub.emit("control", { type: "unwatch-target", target });
}
