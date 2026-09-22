import { useEffect, useRef, useState } from "react";

import { type CanvasNodeStore, useCanvasGenerationTargets } from "./canvas/graph/CanvasNodeStore";
import type { CanvasStatePubSub, CanvasStateSnapshot } from "./domain/canvasStatePubSub";
import { BatchGetCanvasNodeStates } from "./domain/generations";

const POLL_INTERVAL_MS = 3000;
const MAX_TARGETS_PER_REQUEST = 100;

/** Studio 顶层唯一的任务状态轮询入口；结果通过页面级 PubSub 发布给各业务订阅方。 */
export function useCanvasStatePolling({
  canvasId,
  nodePubSub,
  projectId,
  statePubSub,
}: {
  canvasId: string;
  nodePubSub: CanvasNodeStore;
  projectId: string;
  statePubSub: CanvasStatePubSub;
}) {
  const graphTargets = useCanvasGenerationTargets(nodePubSub);
  const [watchedTargets, setWatchedTargets] = useState<
    ReadonlyMap<string, { count: number; target: CanvasStateSnapshot["Targets"][number] }>
  >(new Map());
  const [refreshVersion, setRefreshVersion] = useState(0);
  const inFlightRef = useRef<Promise<CanvasStateSnapshot>>();
  const handledRefreshVersionRef = useRef(0);
  const targets = dedupeTargets([...graphTargets, ...[...watchedTargets.values()].map(({ target }) => target)]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const active = targets.length > 0;
  const activeKey = JSON.stringify(targets);

  useEffect(() => {
    const unsubscribe = statePubSub.on("control", (event) => {
      if (event.type === "refresh") {
        setRefreshVersion((current) => Math.max(current, event.version));
        return;
      }
      setWatchedTargets((current) => {
        const next = new Map(current);
        const key = targetKey(event.target);
        const entry = next.get(key);
        if (event.type === "watch-target") next.set(key, { count: (entry?.count ?? 0) + 1, target: event.target });
        else if (!entry || entry.count <= 1) next.delete(key);
        else next.set(key, { ...entry, count: entry.count - 1 });
        return next;
      });
    });
    return () => {
      unsubscribe();
      statePubSub.emit("error", new DOMException("Canvas polling disposed", "AbortError"));
    };
  }, [statePubSub]);

  useEffect(() => {
    const forceRefresh = refreshVersion > handledRefreshVersionRef.current;
    if (!active && !forceRefresh) return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      if (!inFlightRef.current) {
        const currentTargets = targetsRef.current;
        const batches = currentTargets.length === 0 ? [[]] : chunk(currentTargets, MAX_TARGETS_PER_REQUEST);
        const request = Promise.all(
          batches.map((batch) =>
            BatchGetCanvasNodeStates(
              { ProjectID: projectId, CanvasID: canvasId, Targets: batch },
              { skipErrorNotify: true },
            ),
          ),
        ).then((responses) => ({
          Items: responses.flatMap((response) => response.Items),
          Targets: currentTargets,
          RefreshVersion: refreshVersion,
        }));
        inFlightRef.current = request;
      }
      const request = inFlightRef.current;
      let retryForRefresh = false;
      try {
        const snapshot = await request;
        if (!disposed) {
          if (snapshot.RefreshVersion < refreshVersion) retryForRefresh = true;
          else {
            handledRefreshVersionRef.current = Math.max(handledRefreshVersionRef.current, refreshVersion);
            statePubSub.emit("snapshot", snapshot);
          }
        }
      } catch (error) {
        if (!disposed) {
          handledRefreshVersionRef.current = Math.max(handledRefreshVersionRef.current, refreshVersion);
          statePubSub.emit("error", error);
        }
      } finally {
        if (inFlightRef.current === request) inFlightRef.current = undefined;
      }
      if (!disposed && retryForRefresh) {
        void poll();
        return;
      }
      if (!disposed && active) timer = window.setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [active, activeKey, canvasId, projectId, refreshVersion, statePubSub]);
}

function targetKey(target: CanvasStateSnapshot["Targets"][number]) {
  return `${target.NodeID}:${target.TaskRunID}`;
}

function dedupeTargets(targets: CanvasStateSnapshot["Targets"]) {
  return [...new Map(targets.map((target) => [targetKey(target), target])).values()];
}

function chunk<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
  return result;
}
