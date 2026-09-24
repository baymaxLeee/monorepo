import { streamCanvasNodeTextGeneration } from "@repo/api";
import { toast } from "@repo/design-system";
import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { canvasnode } from "@/domain";
import { CancelCanvasNodeGeneration, StartCanvasNodeGeneration } from "@/pages/studio/domain/generations";
import t from "@/utils/i18n";

import { cancelCancellableVideoGeneration, canvasGenerationFailureFromError } from "../../domain/actions";
import type { CanvasStatePubSub } from "../../domain/canvasStatePubSub";
import { isVideoGenerationCancellationDisabled, videoProviderStatusForRun } from "../../domain/generationCancellation";
import {
  canvasGenerationRuntimeStatesAtom,
  canvasGraphAtom,
  clearCanvasGenerationFailureAtom,
  clearCanvasGenerationRuntimeStateAtom,
  setCanvasGenerationFailureAtom,
  setCanvasGenerationRuntimeStateAtom,
  upsertCanvasNodesAtom,
  useStudioMutationCoordinator,
} from "../../store";
import { isDeletedReferenceNode } from "../graph/canvasNodeHelpers";
import type { CanvasNodeStore } from "../graph/CanvasNodeStore";
import { showGenerationError } from "./showGenerationError";

function generationFailureFallback(type?: canvasnode.CanvasNodeType) {
  switch (type) {
    case canvasnode.CanvasNodeType.TEXT_GENERATION:
      return t("文本生成失败，请重试");
    case canvasnode.CanvasNodeType.IMAGE_GENERATION:
      return t("图片生成失败，请重试");
    default:
      return t("视频生成失败，请重试");
  }
}

export function useCanvasGeneration({
  canvasId,
  projectId,
  nodePubSub,
  statePubSub,
}: {
  canvasId: string;
  projectId: string;
  nodePubSub: CanvasNodeStore;
  statePubSub: CanvasStatePubSub;
}) {
  const mutations = useStudioMutationCoordinator();
  const enqueueCanvasMutation = mutations.enqueue;
  const clearCanvasGenerationFailure = useSetAtom(clearCanvasGenerationFailureAtom);
  const clearCanvasGenerationRuntimeState = useSetAtom(clearCanvasGenerationRuntimeStateAtom);
  const setCanvasGenerationFailure = useSetAtom(setCanvasGenerationFailureAtom);
  const setCanvasGenerationRuntimeState = useSetAtom(setCanvasGenerationRuntimeStateAtom);
  const [textGenerationWaitingNodeIDs, setTextGenerationWaitingNodeIDs] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const textGenerationStreamsRef = useRef(new Map<string, AbortController>());

  useEffect(
    () => () => {
      textGenerationStreamsRef.current.forEach((controller) => controller.abort());
      textGenerationStreamsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    const unsubscribe = statePubSub.on("snapshot", (response) => {
      void (async () => {
        await mutations.waitForIdle();
        if (disposed) return;
        const epoch = mutations.snapshotEpoch();
        if (!mutations.isSnapshotCurrent(epoch)) return;
        const targets = response.Targets;
        const returned = new Set(response.Items.map((item) => `${item.NodeID}:${item.TaskRunID}`));
        response.Items.forEach((state) => {
          const current = nodePubSub.store.get(canvasGraphAtom).nodesById.get(state.NodeID);
          // An old response cannot clear a newer operation or overwrite a newer graph write.
          if (!current || current.ActiveTaskRunID !== state.TaskRunID || state.Node.Revision < current.Revision) return;
          if (state.Node.ActiveTaskRunID && state.Node.ActiveTaskRunID !== state.TaskRunID) {
            nodePubSub.store.set(upsertCanvasNodesAtom, [{ ...state.Node, CanvasNodeNo: current.CanvasNodeNo }]);
            return;
          }
          const terminal =
            state.Status === canvasnode.CanvasGenerationStatus.SUCCEEDED ||
            state.Status === canvasnode.CanvasGenerationStatus.FAILED ||
            state.Status === canvasnode.CanvasGenerationStatus.CANCELLED;
          const matching = state.TaskType === canvasnode.CanvasNodeTaskType.ASSETS_MATCH;
          if (matching) {
            if (state.Status === canvasnode.CanvasGenerationStatus.FAILED)
              toast.add({
                type: "error",
                title: state.ErrorMessage || "素材匹配失败，请重试",
              });
            else if (state.Status === canvasnode.CanvasGenerationStatus.SUCCEEDED)
              toast.add({
                type: "success",
                title: "素材匹配已完成",
              });
          } else if (state.Status === canvasnode.CanvasGenerationStatus.FAILED) {
            const errorMessage = state.ErrorMessage || generationFailureFallback(current.Type);
            setCanvasGenerationFailure({
              nodeId: state.NodeID,
              taskRunId: state.TaskRunID,
              errorCode: state.ErrorCode,
              requestId: state.TaskRunID,
              errorMessage,
              seedanceTaskId: state.SeedanceTaskID,
            });
            showGenerationError(errorMessage);
          } else if (terminal) clearCanvasGenerationFailure(state.NodeID);
          if (terminal || matching) {
            clearCanvasGenerationRuntimeState({
              nodeId: state.NodeID,
              taskRunId: state.TaskRunID,
            });
          } else {
            setCanvasGenerationRuntimeState({
              nodeId: state.NodeID,
              taskRunId: state.TaskRunID,
              status: state.Status,
              providerStatus: state.VideoProviderStatus,
            });
          }
          const nodes = [
            // Related sources may have completed their own generation since this
            // snapshot was read. Hydrate missing nodes without reverting live ones.
            ...state.RelatedNodes.filter((node) => !nodePubSub.store.get(canvasGraphAtom).nodesById.has(node.NodeID)),
            {
              ...state.Node,
              ActiveTaskRunID: terminal ? undefined : state.Node.ActiveTaskRunID,
              ActiveTaskType: terminal ? undefined : state.Node.ActiveTaskType,
              CurrentAssetID: state.Node.CurrentAssetID ?? state.Node.SelectedAssetID,
              CanvasNodeNo: current.CanvasNodeNo,
              LatestGenerationFailure: matching ? current.LatestGenerationFailure : state.Node.LatestGenerationFailure,
            },
          ].filter((node) => {
            const existing = nodePubSub.store.get(canvasGraphAtom).nodesById.get(node.NodeID);
            return !existing || node.Revision >= existing.Revision;
          });
          nodePubSub.store.set(upsertCanvasNodesAtom, nodes);
        });
        targets.forEach((target) => {
          if (returned.has(`${target.NodeID}:${target.TaskRunID}`)) return;
          clearCanvasGenerationRuntimeState({
            nodeId: target.NodeID,
            taskRunId: target.TaskRunID,
          });
          nodePubSub.update(target.NodeID, (current) =>
            current.ActiveTaskRunID !== target.TaskRunID
              ? current
              : {
                  ...current,
                  ActiveTaskType: undefined,
                  ActiveTaskRunID: undefined,
                  Status:
                    current.SelectedOutputID || current.SelectedAssetID || current.SelectedOutputText
                      ? canvasnode.CanvasNodeStatus.READY
                      : canvasnode.CanvasNodeStatus.EMPTY,
                },
          );
        });
      })();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [
    clearCanvasGenerationRuntimeState,
    clearCanvasGenerationFailure,
    nodePubSub,
    mutations,
    setCanvasGenerationFailure,
    setCanvasGenerationRuntimeState,
    statePubSub,
  ]);

  const subscribeTextGeneration = useCallback(
    async (item: canvasnode.CanvasNode) => {
      textGenerationStreamsRef.current.get(item.NodeID)?.abort();
      const controller = new AbortController();
      textGenerationStreamsRef.current.set(item.NodeID, controller);
      setTextGenerationWaitingNodeIDs((current) => new Set(current).add(item.NodeID));
      clearCanvasGenerationFailure(item.NodeID);
      let latestTaskRunId: string | undefined;
      try {
        const final = await streamCanvasNodeTextGeneration(
          projectId,
          canvasId,
          item.NodeID,
          controller.signal,
          (state) => {
            latestTaskRunId = state.taskRunId;
            if (state.content) {
              setTextGenerationWaitingNodeIDs((current) => {
                if (!current.has(item.NodeID)) return current;
                const next = new Set(current);
                next.delete(item.NodeID);
                return next;
              });
            }
            const terminal =
              state.status === canvasnode.CanvasGenerationStatus.SUCCEEDED ||
              state.status === canvasnode.CanvasGenerationStatus.FAILED ||
              state.status === canvasnode.CanvasGenerationStatus.CANCELLED;
            if (state.status === canvasnode.CanvasGenerationStatus.FAILED) {
              setCanvasGenerationFailure({
                nodeId: item.NodeID,
                taskRunId: state.taskRunId,
                errorCode: state.errorCode,
                requestId: state.taskRunId,
                errorMessage: state.errorMessage || generationFailureFallback(item.Type),
              });
            } else if (
              state.status === canvasnode.CanvasGenerationStatus.SUCCEEDED ||
              state.status === canvasnode.CanvasGenerationStatus.CANCELLED
            ) {
              clearCanvasGenerationFailure(item.NodeID);
            }
            nodePubSub.update(item.NodeID, (current) => ({
              ...current,
              ActiveTaskRunID: terminal ? undefined : state.taskRunId,
              SelectedOutputText:
                state.status === canvasnode.CanvasGenerationStatus.SUCCEEDED
                  ? state.content
                  : terminal
                    ? current.SelectedOutputText
                    : state.content,
              Status: terminal
                ? current.SelectedOutputText
                  ? canvasnode.CanvasNodeStatus.READY
                  : canvasnode.CanvasNodeStatus.EMPTY
                : canvasnode.CanvasNodeStatus.GENERATING,
            }));
          },
        );
        if (!controller.signal.aborted && final) {
          if (final.status === canvasnode.CanvasGenerationStatus.SUCCEEDED)
            toast.add({
              type: "success",
              title: t("文本生成完成"),
            });
          else if (final.status === canvasnode.CanvasGenerationStatus.FAILED)
            toast.add({
              type: "error",
              title: final.errorMessage || t("文本生成失败"),
            });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          const fallbackMessage =
            error instanceof Error && error.message.trim()
              ? error.message.trim()
              : generationFailureFallback(item.Type);
          const failure = canvasGenerationFailureFromError(error, fallbackMessage);
          setCanvasGenerationFailure({ nodeId: item.NodeID, ...failure });
          nodePubSub.update(item.NodeID, (current) => ({
            ...current,
            ActiveTaskRunID: latestTaskRunId ?? current.ActiveTaskRunID,
            Status:
              latestTaskRunId || current.ActiveTaskRunID
                ? canvasnode.CanvasNodeStatus.GENERATING
                : current.SelectedOutputText
                  ? canvasnode.CanvasNodeStatus.READY
                  : canvasnode.CanvasNodeStatus.EMPTY,
          }));
          showGenerationError(failure.errorMessage ?? fallbackMessage);
        }
      } finally {
        if (textGenerationStreamsRef.current.get(item.NodeID) === controller) {
          textGenerationStreamsRef.current.delete(item.NodeID);
          setTextGenerationWaitingNodeIDs((current) => {
            if (!current.has(item.NodeID)) return current;
            const next = new Set(current);
            next.delete(item.NodeID);
            return next;
          });
        }
      }
    },
    [canvasId, clearCanvasGenerationFailure, nodePubSub, projectId, setCanvasGenerationFailure],
  );

  const cancelNodeGeneration = useCallback(
    async (item: canvasnode.CanvasNode) => {
      if (isDeletedReferenceNode(item)) return;
      const activeTaskRunId = item.ActiveTaskRunID;
      if (!activeTaskRunId) return;
      const generationStatus = videoProviderStatusForRun(
        nodePubSub.store.get(canvasGenerationRuntimeStatesAtom),
        item.NodeID,
        activeTaskRunId,
      );
      if (
        item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION &&
        isVideoGenerationCancellationDisabled(generationStatus)
      ) {
        toast.add({
          type: "info",
          title: t("视频已开始生成，无法取消"),
        });
        return;
      }
      try {
        if (item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION) {
          await enqueueCanvasMutation(() =>
            CancelCanvasNodeGeneration(
              {
                ProjectID: projectId,
                CanvasID: canvasId,
                NodeID: item.NodeID,
                TaskRunID: activeTaskRunId,
              },
              { skipErrorNotify: true },
            ),
          );
          textGenerationStreamsRef.current.get(item.NodeID)?.abort();
        } else if (item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION) {
          const result = await enqueueCanvasMutation(() =>
            cancelCancellableVideoGeneration(projectId, canvasId, item.NodeID, activeTaskRunId),
          );
          if (
            result.status === canvasnode.CanvasGenerationStatus.QUEUED ||
            result.status === canvasnode.CanvasGenerationStatus.RUNNING
          ) {
            setCanvasGenerationRuntimeState({
              nodeId: item.NodeID,
              taskRunId: activeTaskRunId,
              status: result.status,
              providerStatus: result.providerStatus,
            });
          }
          if (!result.cancelled) {
            if (isVideoGenerationCancellationDisabled(result.providerStatus)) {
              toast.add({
                type: "info",
                title: t("视频已开始生成，无法取消"),
              });
            } else {
              toast.add({
                type: "warning",
                title: t("生成任务尚未就绪，请稍后重试"),
              });
            }
            return;
          }
        } else {
          await enqueueCanvasMutation(() =>
            CancelCanvasNodeGeneration(
              {
                ProjectID: projectId,
                CanvasID: canvasId,
                NodeID: item.NodeID,
                TaskRunID: activeTaskRunId,
              },
              { skipErrorNotify: true },
            ),
          );
        }
        nodePubSub.update(item.NodeID, (current) =>
          current.ActiveTaskRunID === activeTaskRunId
            ? {
                ...current,
                ActiveTaskRunID: undefined,
                Status:
                  current.SelectedOutputID || current.SelectedAssetID || current.SelectedOutputText
                    ? canvasnode.CanvasNodeStatus.READY
                    : canvasnode.CanvasNodeStatus.EMPTY,
              }
            : current,
        );
        clearCanvasGenerationFailure(item.NodeID);
        clearCanvasGenerationRuntimeState({
          nodeId: item.NodeID,
          taskRunId: activeTaskRunId,
        });
        toast.add({
          type: "success",
          title: t("已取消生成"),
        });
      } catch {
        toast.add({
          type: "error",
          title: t("取消生成失败"),
        });
      }
    },
    [
      canvasId,
      clearCanvasGenerationRuntimeState,
      clearCanvasGenerationFailure,
      enqueueCanvasMutation,
      nodePubSub,
      projectId,
      setCanvasGenerationRuntimeState,
    ],
  );

  const generateNode = useCallback(
    async (item: canvasnode.CanvasNode) => {
      if (isDeletedReferenceNode(item) || item.ActiveTaskRunID) return;
      if (item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION) {
        void subscribeTextGeneration(item);
        return;
      }
      try {
        const started = await enqueueCanvasMutation(() =>
          StartCanvasNodeGeneration(
            {
              ProjectID: projectId,
              CanvasID: canvasId,
              NodeID: item.NodeID,
            },
            { skipErrorNotify: true },
          ),
        );
        clearCanvasGenerationFailure(item.NodeID);
        setCanvasGenerationRuntimeState({
          nodeId: item.NodeID,
          taskRunId: started.TaskRunID,
          status: canvasnode.CanvasGenerationStatus.QUEUED,
        });
        nodePubSub.update(item.NodeID, (current) => ({
          ...current,
          ActiveTaskRunID: started.TaskRunID,
          Status: canvasnode.CanvasNodeStatus.GENERATING,
        }));
      } catch (error) {
        const fallbackMessage = t(
          item.Type === canvasnode.CanvasNodeType.IMAGE_GENERATION ? "图片生成启动失败" : "视频生成启动失败",
        );
        const failure = canvasGenerationFailureFromError(error, fallbackMessage);
        setCanvasGenerationFailure({ nodeId: item.NodeID, ...failure });
        showGenerationError(failure.errorMessage ?? fallbackMessage);
      }
    },
    [
      canvasId,
      clearCanvasGenerationFailure,
      enqueueCanvasMutation,
      nodePubSub,
      projectId,
      setCanvasGenerationFailure,
      setCanvasGenerationRuntimeState,
      subscribeTextGeneration,
    ],
  );

  return { generateNode, cancelNodeGeneration, textGenerationWaitingNodeIDs };
}
