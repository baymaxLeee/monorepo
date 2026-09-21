import { useAtomValue } from "jotai";
import { useEffect } from "react";

import { agentframeService } from "@/api";
import { batchGetAssetReviews } from "@/api/assetReviews";

import { pendingAssetReviewIDsAtom, useStudioAssetStore } from "./store/assets";

const REVIEW_POLL_INTERVAL_MS = 3000;
const REVIEW_POLL_BATCH_SIZE = 100;

function chunkAssetIDs(assetIDs: readonly string[]) {
  const chunks: string[][] = [];
  for (let index = 0; index < assetIDs.length; index += REVIEW_POLL_BATCH_SIZE) {
    chunks.push(assetIDs.slice(index, index + REVIEW_POLL_BATCH_SIZE));
  }
  return chunks;
}

/** Studio 审核状态以 Asset 为事实源，独立于 CanvasNode 的生成状态轮询。 */
export function useStudioAssetReviewPolling(projectId: string, enabled: boolean) {
  const assetStore = useStudioAssetStore();
  const pendingAssetIDs = useAtomValue(pendingAssetReviewIDsAtom);
  const pendingAssetIDsKey = JSON.stringify(pendingAssetIDs);

  useEffect(() => {
    const batches = chunkAssetIDs(JSON.parse(pendingAssetIDsKey) as string[]);
    if (!enabled || !projectId || !batches.length) return;

    let disposed = false;
    let timer: number | undefined;

    const poll = async () => {
      const results = await Promise.allSettled(
        batches.map((assetIDs) =>
          batchGetAssetReviews(agentframeService, projectId, assetIDs, { skipErrorNotify: true }),
        ),
      );
      if (disposed) return;

      const items = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
      if (items.length) assetStore.replaceReviews(items);
      timer = window.setTimeout(poll, REVIEW_POLL_INTERVAL_MS);
    };

    timer = window.setTimeout(poll, REVIEW_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [assetStore, enabled, pendingAssetIDsKey, projectId]);
}
