import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { agentframeService } from "@/api";
import { batchGetAssetReviews } from "@/api/assetReviews";
import { Message } from "@/components/ui";
import { asset, resource } from "@/domain";
import { latestAssetReview } from "@/utils/assetReview";
import t from "@/utils/i18n";

import { batchGetResourceAssetGenerationStates, cancelResourceAssetGeneration } from "../domain/actions";

const GENERATION_STATUS_POLL_INTERVAL_MS = 3000;
export function useResourceAssetStatus({
  files,
  setFiles,
  projectId,
  resourceId,
  load,
  onChange,
}: {
  files: resource.ResourceAsset[];
  setFiles: Dispatch<SetStateAction<resource.ResourceAsset[]>>;
  projectId: string;
  resourceId: string;
  load: (showLoading?: boolean) => Promise<resource.ResourceAsset[] | undefined>;
  onChange: () => void;
}) {
  const [generatingFileIds, setGeneratingFileIds] = useState<Set<string>>(() => new Set());
  const [generationFailures, setGenerationFailures] = useState<Map<string, { code?: string; message?: string }>>(
    () => new Map(),
  );
  const activeGenerationRunIdsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const running = files.filter(
      (file) =>
        file.GenerationState?.Status === resource.ResourceAssetGenerationRunStatus.QUEUED ||
        file.GenerationState?.Status === resource.ResourceAssetGenerationRunStatus.RUNNING,
    );
    activeGenerationRunIdsRef.current = new Map(
      running.map((file) => [file.ResourceAssetID, file.GenerationState!.TaskRunID]),
    );
    setGeneratingFileIds(new Set(running.map((file) => file.ResourceAssetID)));
    setGenerationFailures(
      new Map(
        files
          .filter((file) => file.GenerationState?.Status === resource.ResourceAssetGenerationRunStatus.FAILED)
          .map((file) => [
            file.ResourceAssetID,
            {
              code: file.GenerationState?.ErrorCode,
              message: file.GenerationState?.ErrorMessage,
            },
          ]),
      ),
    );
  }, [files]);

  useEffect(() => {
    if (!generatingFileIds.size) return;
    const timer = window.setTimeout(() => {
      void batchGetResourceAssetGenerationStates(agentframeService, projectId, resourceId, [...generatingFileIds])
        .then((states) => {
          const statesByID = new Map(states.map((state) => [state.ResourceAssetID, state]));
          const statuses = [...generatingFileIds].map((id) => {
            const state = statesByID.get(id);
            const generating =
              state?.Status === resource.ResourceAssetGenerationRunStatus.QUEUED ||
              state?.Status === resource.ResourceAssetGenerationRunStatus.RUNNING;
            return {
              failure:
                state?.Status === resource.ResourceAssetGenerationRunStatus.FAILED
                  ? { code: state.ErrorCode, message: state.ErrorMessage }
                  : undefined,
              id,
              runId: state?.TaskRunID,
              generating,
            };
          });
          const completed = statuses.filter((status) => status.generating === false);
          setGeneratingFileIds((current) => {
            const next = new Set(current);
            for (const status of statuses) {
              if (status.generating === true && status.runId) {
                next.add(status.id);
                activeGenerationRunIdsRef.current.set(status.id, status.runId);
              } else if (status.generating === false) {
                next.delete(status.id);
                activeGenerationRunIdsRef.current.delete(status.id);
              }
            }
            return next;
          });
          setGenerationFailures((current) => {
            const next = new Map(current);
            for (const status of statuses) {
              if (status.generating === true) next.delete(status.id);
              else if (status.generating === false && status.failure) next.set(status.id, status.failure);
              else if (status.generating === false) next.delete(status.id);
            }
            return next;
          });
          if (completed.length) {
            void load(false);
            onChange();
          }
        })
        .catch(() => undefined);
    }, GENERATION_STATUS_POLL_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [files, generatingFileIds, load, onChange, projectId, resourceId]);

  useEffect(() => {
    if (
      !resourceId ||
      !files.some(
        (file) =>
          latestAssetReview(file.Reviews)?.Status === asset.AssetReviewStatus.SUBMITTING ||
          latestAssetReview(file.Reviews)?.Status === asset.AssetReviewStatus.PROCESSING,
      )
    ) {
      return;
    }
    const timer = window.setTimeout(() => {
      const assetIds = files.flatMap((file) => (file.CurrentAssetID ? [file.CurrentAssetID] : []));
      void batchGetAssetReviews(agentframeService, projectId, assetIds)
        .then((items) => {
          const reviewsByAssetId = new Map(items.map((item) => [item.AssetID, item.Reviews]));
          setFiles((current) =>
            current.map((file) => ({
              ...file,
              Reviews: file.CurrentAssetID ? reviewsByAssetId.get(file.CurrentAssetID) : file.Reviews,
            })),
          );
        })
        .catch(() => undefined);
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [files, projectId, resourceId]);

  const stopGeneration = async (file: resource.ResourceAsset) => {
    const runId = activeGenerationRunIdsRef.current.get(file.ResourceAssetID);
    if (!runId) return;
    try {
      await cancelResourceAssetGeneration(agentframeService, projectId, resourceId, file.ResourceAssetID, runId);
      activeGenerationRunIdsRef.current.delete(file.ResourceAssetID);
      setGeneratingFileIds((current) => {
        const next = new Set(current);
        next.delete(file.ResourceAssetID);
        return next;
      });
      void load(false);
      onChange();
    } catch {
      Message.error(t("停止生成失败，请重试"));
    }
  };

  const updateGenerationRun = (id: string, runId?: string) => {
    setGeneratingFileIds((current) => {
      const next = new Set(current);
      if (runId) next.add(id);
      else next.delete(id);
      return next;
    });
    if (runId) activeGenerationRunIdsRef.current.set(id, runId);
    else activeGenerationRunIdsRef.current.delete(id);
  };
  return {
    generatingFileIds,
    generationFailures,
    stopGeneration,
    updateGenerationRun,
    resetGenerationFailures: () => setGenerationFailures(new Map()),
  };
}
