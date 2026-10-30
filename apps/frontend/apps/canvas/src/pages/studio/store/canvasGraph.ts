import { atom } from "jotai";

import { canvasnode } from "@/domain";

import { canvasFromDTO } from "../../canvases/actions";
import { shotFromDTO, storyboardDraftShotFromNode } from "../domain/actions";
import type { CanvasGenerationRuntimeState } from "../domain/generationCancellation";
import { presentNode } from "../domain/persistence";
import type { CanvasGenerationFailure } from "../domain/types";
import type { CanvasProjection } from "./streamProjection";

type RawNode = CanvasProjection["nodes"] extends Map<string, infer N> ? N : never;
type Task = CanvasProjection["tasks"] extends Map<string, infer T> ? T : never;
type Text = CanvasProjection["texts"] extends Map<string, infer T> ? T : never;
const presentationCache = new WeakMap<
  RawNode,
  { task: Task | undefined; text: Text | undefined; value: canvasnode.CanvasNode }
>();
function presentProjectedNode(node: RawNode, task: Task | undefined, text: Text | undefined) {
  const cached = presentationCache.get(node);
  if (cached && cached.task === task && cached.text === text) return cached.value;
  const value = presentNode(node);
  value.ActiveTaskType = task?.task_type;
  if (task && isPending(task)) value.ActiveTaskRunID = task.task_run_id;
  if (value.ActiveTaskRunID) {
    value.Status =
      task?.task_type === canvasnode.CanvasNodeTaskType.ASSETS_MATCH
        ? node.selected_output_id ||
          node.selected_asset_id ||
          node.selected_output_text ||
          node.resource_asset_id ||
          node.resource_id
          ? canvasnode.CanvasNodeStatus.READY
          : canvasnode.CanvasNodeStatus.EMPTY
        : canvasnode.CanvasNodeStatus.GENERATING;
  }
  if (text && text.task_run_id === value.ActiveTaskRunID && (text.status === "running" || text.status === "queued"))
    value.SelectedOutputText = text.content;
  presentationCache.set(node, { task, text, value });
  return value;
}
function isPending(task: Task) {
  return (
    task.status === canvasnode.CanvasGenerationStatus.RUNNING ||
    task.status === canvasnode.CanvasGenerationStatus.QUEUED
  );
}
const projectionAtom = atom<CanvasProjection | undefined>(undefined);
export const canvasAtom = atom((get) => {
  const projection = get(projectionAtom);
  return projection ? canvasFromDTO(projection.canvas) : undefined;
});
export const canvasArchivesAtom = atom((get) =>
  [...(get(projectionAtom)?.archives.values() ?? [])].sort(
    (a, b) => b.created_at.localeCompare(a.created_at) || b.task_run_id.localeCompare(a.task_run_id),
  ),
);

export const canvasGraphLoadedAtom = atom((get) => Boolean(get(projectionAtom)));
export const canvasGraphAtom = atom((get) => {
  const projection = get(projectionAtom);
  const pendingByNode = new Map(
    [...(projection?.tasks.values() ?? [])].filter(isPending).map((task) => [task.node_id, task]),
  );
  const nodes = [...(projection?.nodes.values() ?? [])].map((node) => {
    // Video output can be committed before its frame extraction task finishes.
    const active = node.active_task_run_id
      ? projection?.tasks.get(node.active_task_run_id)
      : pendingByNode.get(node.node_id);
    return presentProjectedNode(node, active, projection?.texts.get(node.node_id));
  });
  return { nodeIds: nodes.map((node) => node.NodeID), nodesById: new Map(nodes.map((node) => [node.NodeID, node])) };
});
export const canvasNodesAtom = atom((get) => [...get(canvasGraphAtom).nodesById.values()]);
export const installCanvasProjectionAtom = atom(
  (get) => get(canvasNodesAtom),
  (_get, set, projection: CanvasProjection) => set(projectionAtom, projection),
);
export const canvasGenerationFailuresAtom = atom((get) => {
  const failures = new Map<string, CanvasGenerationFailure>();
  const projection = get(projectionAtom);
  for (const task of projection?.tasks.values() ?? []) {
    const node = projection?.nodes.get(task.node_id);
    if (!node || (node.active_task_run_id && node.active_task_run_id !== task.task_run_id)) continue;
    if (
      task.task_type !== canvasnode.CanvasNodeTaskType.ASSETS_MATCH &&
      task.status === canvasnode.CanvasGenerationStatus.FAILED
    )
      failures.set(task.node_id, {
        taskRunId: task.task_run_id,
        errorCode: task.error_code,
        errorMessage: task.error_message,
        seedanceTaskId: task.seedance_task_id,
      });
  }
  return failures;
});
export const canvasGenerationRuntimeStatesAtom = atom((get) => {
  const runtime = new Map<string, CanvasGenerationRuntimeState>();
  const projection = get(projectionAtom);
  for (const task of projection?.tasks.values() ?? []) {
    const node = projection?.nodes.get(task.node_id);
    if (!node || (node.active_task_run_id && node.active_task_run_id !== task.task_run_id)) continue;
    if (
      task.task_type !== canvasnode.CanvasNodeTaskType.ASSETS_MATCH &&
      (task.status === canvasnode.CanvasGenerationStatus.RUNNING ||
        task.status === canvasnode.CanvasGenerationStatus.QUEUED)
    )
      runtime.set(task.node_id, {
        taskRunId: task.task_run_id,
        status: task.status,
        providerStatus: task.video_provider_status,
      });
  }
  return runtime;
});

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
  const draftTasks = get(canvasNodesAtom).flatMap((node) => {
    const task = storyboardDraftShotFromNode(node);
    return task ? [task] : [];
  });
  return [...formal, ...draftTasks];
});
