import { atom } from "jotai";

import { canvasnode } from "@/domain";

import { shotFromDTO, storyboardDraftShotFromNode } from "../domain/actions";
import type { CanvasGenerationRuntimeState } from "../domain/generationCancellation";
import type { CanvasGenerationFailure, Shot } from "../domain/types";

type CanvasGraphState = {
  nodeIds: string[];
  nodesById: Map<string, canvasnode.CanvasNode>;
};

const emptyGraph = (): CanvasGraphState => ({
  nodeIds: [],
  nodesById: new Map(),
});

const mergeCanvasNode = (
  current: canvasnode.CanvasNode | undefined,
  next: canvasnode.CanvasNode,
): canvasnode.CanvasNode => {
  if (!current) return next;
  const sameResourceAsset = current.ResourceAssetID === next.ResourceAssetID;
  const nextCurrentAssetID = next.CurrentAssetID ?? (sameResourceAsset ? current.CurrentAssetID : undefined);
  return {
    ...next,
    CanvasNodeNo: next.CanvasNodeNo || current.CanvasNodeNo,
    CurrentAssetID: nextCurrentAssetID,
    ResourceAssetRevision:
      next.ResourceAssetRevision ?? (sameResourceAsset ? current.ResourceAssetRevision : undefined),
    ResourceAssetIsPrimary:
      next.ResourceAssetIsPrimary ?? (sameResourceAsset ? current.ResourceAssetIsPrimary : undefined),
  };
};

export const canvasGraphAtom = atom<CanvasGraphState>(emptyGraph());
export const canvasGraphLoadedAtom = atom(false);
export const canvasNodesAtom = atom((get) => {
  const graph = get(canvasGraphAtom);
  return graph.nodeIds.flatMap((id) => {
    const node = graph.nodesById.get(id);
    return node ? [node] : [];
  });
});

export const canvasGenerationFailuresAtom = atom<Map<string, CanvasGenerationFailure>>(new Map());

/** 平台任务状态和视频 provider 观察分开保存；仅 providerStatus 用于取消判断。 */
export const canvasGenerationRuntimeStatesAtom = atom<Map<string, CanvasGenerationRuntimeState>>(new Map());

export const setCanvasGenerationRuntimeStateAtom = atom(
  null,
  (get, set, update: CanvasGenerationRuntimeState & { nodeId: string }) => {
    const current = get(canvasGenerationRuntimeStatesAtom);
    const previous = current.get(update.nodeId);
    if (
      previous?.taskRunId === update.taskRunId &&
      previous.status === update.status &&
      previous.providerStatus === update.providerStatus
    ) {
      return;
    }
    const next = new Map(current);
    const { nodeId, ...state } = update;
    next.set(nodeId, state);
    set(canvasGenerationRuntimeStatesAtom, next);
  },
);

export const clearCanvasGenerationRuntimeStateAtom = atom(
  null,
  (get, set, update: { nodeId: string; taskRunId?: string }) => {
    const current = get(canvasGenerationRuntimeStatesAtom);
    const state = current.get(update.nodeId);
    if (!state || (update.taskRunId && state.taskRunId !== update.taskRunId)) {
      return;
    }
    const next = new Map(current);
    next.delete(update.nodeId);
    set(canvasGenerationRuntimeStatesAtom, next);
  },
);

export const setCanvasGenerationFailureAtom = atom(
  null,
  (
    get,
    set,
    update: CanvasGenerationFailure & {
      nodeId: string;
    },
  ) => {
    const next = new Map(get(canvasGenerationFailuresAtom));
    const { nodeId, ...failure } = update;
    next.set(nodeId, failure);
    set(canvasGenerationFailuresAtom, next);
  },
);

export const clearCanvasGenerationFailureAtom = atom(null, (get, set, nodeId: string) => {
  const current = get(canvasGenerationFailuresAtom);
  if (!current.has(nodeId)) return;
  const next = new Map(current);
  next.delete(nodeId);
  set(canvasGenerationFailuresAtom, next);
});

export const replaceCanvasNodesAtom = atom(null, (_get, set, nodes: canvasnode.CanvasNode[]) => {
  set(canvasGraphAtom, {
    nodeIds: nodes.map((node) => node.NodeID),
    nodesById: new Map(nodes.map((node) => [node.NodeID, node])),
  });
  set(
    canvasGenerationFailuresAtom,
    new Map(
      nodes.flatMap((node) => {
        const failure = node.LatestGenerationFailure;
        return failure
          ? [
              [
                node.NodeID,
                {
                  taskRunId: failure.TaskRunID,
                  errorCode: failure.ErrorCode,
                  errorMessage: failure.ErrorMessage,
                  seedanceTaskId: failure.SeedanceTaskID,
                },
              ] as const,
            ]
          : [];
      }),
    ),
  );
  set(canvasGraphLoadedAtom, true);
});

export const upsertCanvasNodesAtom = atom(null, (get, set, nodes: canvasnode.CanvasNode[]) => {
  if (!nodes.length) return;
  const current = get(canvasGraphAtom);
  const nodeIds = [...current.nodeIds];
  const nodesById = new Map(current.nodesById);
  for (const node of nodes) {
    if (!nodesById.has(node.NodeID)) nodeIds.push(node.NodeID);
    nodesById.set(node.NodeID, mergeCanvasNode(nodesById.get(node.NodeID), node));
  }
  set(canvasGraphAtom, { nodeIds, nodesById });
});

export const patchCanvasNodeAtom = atom(
  null,
  (
    get,
    set,
    update: {
      nodeId: string;
      patch: Partial<canvasnode.CanvasNode>;
    },
  ) => {
    const current = get(canvasGraphAtom);
    const node = current.nodesById.get(update.nodeId);
    if (!node) return;
    const nodesById = new Map(current.nodesById);
    nodesById.set(update.nodeId, { ...node, ...update.patch });
    set(canvasGraphAtom, { ...current, nodesById });
  },
);

export const removeCanvasNodeAtom = atom(null, (get, set, nodeId: string) => {
  const current = get(canvasGraphAtom);
  if (!current.nodesById.has(nodeId)) return;
  const nodesById = new Map(current.nodesById);
  nodesById.delete(nodeId);
  for (const [id, node] of nodesById) {
    const incomingEdges = node.IncomingEdges.filter((edge) => edge.SourceNodeID !== nodeId);
    if (incomingEdges.length !== node.IncomingEdges.length) {
      nodesById.set(id, { ...node, IncomingEdges: incomingEdges });
    }
  }
  set(canvasGraphAtom, {
    nodeIds: current.nodeIds.filter((id) => id !== nodeId),
    nodesById,
  });
  const generationStates = new Map(get(canvasGenerationRuntimeStatesAtom));
  generationStates.delete(nodeId);
  set(canvasGenerationRuntimeStatesAtom, generationStates);
});

export const reorderStoryboardNodesAtom = atom(null, (get, set, orderedIds: string[]) => {
  const current = get(canvasGraphAtom);
  const nodesById = new Map(current.nodesById);
  orderedIds.forEach((nodeId, index) => {
    const node = nodesById.get(nodeId);
    if (node) {
      nodesById.set(nodeId, { ...node, StoryboardRank: index + 1 });
    }
  });
  set(canvasGraphAtom, { ...current, nodesById });
});

export const storyboardOptimisticShotsAtom = atom<Shot[]>([]);

export const storyboardShotsAtom = atom((get) => {
  const failures = get(canvasGenerationFailuresAtom);
  const formal = get(canvasNodesAtom)
    .filter((node) => node.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION)
    .sort(
      (left, right) =>
        (left.StoryboardRank ?? Number.MAX_SAFE_INTEGER) - (right.StoryboardRank ?? Number.MAX_SAFE_INTEGER) ||
        left.CreatedAt.localeCompare(right.CreatedAt) ||
        left.NodeID.localeCompare(right.NodeID),
    )
    .map((node) => {
      const shot = shotFromDTO(node);
      const failure = failures.get(node.NodeID);
      return failure && shot.status !== "generating"
        ? {
            ...shot,
            status: "failed" as const,
            generationErrorCode: failure.errorCode,
            generationErrorMessage: failure.errorMessage,
            generationRequestId: failure.requestId ?? failure.taskRunId,
            generationSeedanceTaskId: failure.seedanceTaskId,
          }
        : shot;
    });
  const projected = [...formal];
  for (const shot of get(storyboardOptimisticShotsAtom)) {
    const afterIndex = shot.optimisticAfterNodeId
      ? projected.findIndex((item) => item.id === shot.optimisticAfterNodeId)
      : -1;
    const insertIndex = shot.optimisticAfterNodeId ? (afterIndex >= 0 ? afterIndex + 1 : projected.length) : 0;
    projected.splice(insertIndex, 0, shot);
  }
  const draftTasks = get(canvasNodesAtom).flatMap((node) => {
    const task = storyboardDraftShotFromNode(node);
    return task ? [task] : [];
  });
  return [...projected, ...draftTasks];
});

export const resetCanvasGraphAtom = atom(null, (_get, set) => {
  set(canvasGraphAtom, emptyGraph());
  set(canvasGraphLoadedAtom, false);
  set(storyboardOptimisticShotsAtom, []);
  set(canvasGenerationFailuresAtom, new Map());
  set(canvasGenerationRuntimeStatesAtom, new Map());
});
