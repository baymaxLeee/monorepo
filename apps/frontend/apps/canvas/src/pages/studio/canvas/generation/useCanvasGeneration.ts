import { useSetAtom } from "jotai";
import { useCallback, useEffect, useRef, useState } from "react";

import { Message } from "@/components/ui";
import { canvasnode } from "@/domain";
import {
  CancelCanvasNodeTextGeneration,
  BatchGetCanvasNodeStates,
  CancelCanvasNodeGeneration,
  StartCanvasNodeGeneration,
} from "@/pages/studio/domain/generations";
import t from "@/utils/i18n";

import {
  cancelCancellableVideoGeneration,
  canvasGenerationFailureFromError,
  streamCanvasNodeTextGeneration,
} from "../../domain/actions";
import { isVideoGenerationCancellationDisabled, videoProviderStatusForRun } from "../../domain/generationCancellation";
import {
  canvasGenerationRuntimeStatesAtom,
  canvasGraphAtom,
  clearCanvasGenerationFailureAtom,
  clearCanvasGenerationRuntimeStateAtom,
  setCanvasGenerationFailureAtom,
  setCanvasGenerationRuntimeStateAtom,
  upsertCanvasNodesAtom,
  updateCanvasRevisionAtom,
  useStudioMutationCoordinator,
} from "../../store";
import { isDeletedReferenceNode } from "../graph/canvasNodeHelpers";
import { type CanvasNodeStore, useCanvasGenerationTargets } from "../graph/CanvasNodeStore";
import { showGenerationError } from "./showGenerationError";

const CANVAS_GENERATION_POLL_INTERVAL_MS = 3000;

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
}: {
  canvasId: string;
  projectId: string;
  nodePubSub: CanvasNodeStore;
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
  const generationTargets = useCanvasGenerationTargets(nodePubSub);
  const generationTargetsRef = useRef(generationTargets);
  generationTargetsRef.current = generationTargets;
  const generationTargetsKey = JSON.stringify(generationTargets);

  useEffect(
    () => () => {
      textGenerationStreamsRef.current.forEach((controller) => controller.abort());
      textGenerationStreamsRef.current.clear();
    },
    [],
  );
  useEffect(() => {
    if (generationTargetsKey === "[]") return;
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      const targets = generationTargetsRef.current;
      try {
        await mutations.waitForIdle();
        if (disposed) return;
        const epoch = mutations.snapshotEpoch();
        const batches: Promise<canvasnode.BatchGetCanvasNodeStatesResponse>[] = [];
        for (let offset = 0; offset < targets.length; offset += 100) {
          batches.push(
            BatchGetCanvasNodeStates(
              {
                ProjectID: projectId,
                CanvasID: canvasId,
                Targets: targets.slice(offset, offset + 100),
              },
              { skipErrorNotify: true },
            ),
          );
        }
        const responses = await Promise.all(batches);
        if (disposed || !mutations.isSnapshotCurrent(epoch)) return;
        const response = { Items: responses.flatMap((batch) => batch.Items) };
        const canvasRevision = Math.max(...responses.map((batch) => batch.CanvasRevision ?? 0));
        if (canvasRevision > 0) nodePubSub.store.set(updateCanvasRevisionAtom, canvasRevision);
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
              Message.error(state.ErrorMessage || "素材匹配失败，请重试");
            else if (state.Status === canvasnode.CanvasGenerationStatus.SUCCEEDED) Message.success("素材匹配已完成");
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
      } catch {
        // Transient polling failures retain the latest node-local snapshot.
      } finally {
        if (!disposed) {
          timer = window.setTimeout(poll, CANVAS_GENERATION_POLL_INTERVAL_MS);
        }
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [
    canvasId,
    clearCanvasGenerationRuntimeState,
    clearCanvasGenerationFailure,
    generationTargetsKey,
    nodePubSub,
    mutations,
    projectId,
    setCanvasGenerationFailure,
    setCanvasGenerationRuntimeState,
  ]);

  const subscribeTextGeneration = useCallback(
    async (item: canvasnode.CanvasNode) => {
      textGenerationStreamsRef.current.get(item.NodeID)?.abort();
      const controller = new AbortController();
      textGenerationStreamsRef.current.set(item.NodeID, controller);
      setTextGenerationWaitingNodeIDs((current) => {
        const next = new Set(current);
        next.add(item.NodeID);
        return next;
      });
      clearCanvasGenerationFailure(item.NodeID);
      try {
        const final = await streamCanvasNodeTextGeneration(
          {
            ProjectID: projectId,
            CanvasID: canvasId,
            NodeID: item.NodeID,
          },
          controller.signal,
          (state) => {
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
              SelectedOutputText: state.content,
              Status: terminal ? canvasnode.CanvasNodeStatus.READY : canvasnode.CanvasNodeStatus.GENERATING,
            }));
          },
        );
        if (!controller.signal.aborted && final) {
          if (final.status === canvasnode.CanvasGenerationStatus.SUCCEEDED) {
            Message.success(t("文本生成完成"));
          } else if (final.status === canvasnode.CanvasGenerationStatus.FAILED) {
            showGenerationError(final.errorMessage || t("文本生成失败"));
          }
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
            ActiveTaskRunID: undefined,
            Status: current.SelectedOutputText ? canvasnode.CanvasNodeStatus.READY : canvasnode.CanvasNodeStatus.EMPTY,
          }));
          showGenerationError(failure.errorMessage);
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
        Message.info(t("视频已开始生成，无法取消"));
        return;
      }
      try {
        if (item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION) {
          await enqueueCanvasMutation(() =>
            CancelCanvasNodeTextGeneration(
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
              Message.info(t("视频已开始生成，无法取消"));
            } else {
              Message.warning(t("生成任务尚未就绪，请稍后重试"));
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
        Message.success(t("已取消生成"));
      } catch {
        Message.error(t("取消生成失败"));
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
