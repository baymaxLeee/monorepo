import { atom, useStore } from "jotai";
import { useMemo } from "react";

import type { MentionIdReplacement } from "@/components/promptEditor";
import { asset } from "@/domain";
import { latestAssetReview } from "@/utils/assetReview";

import { preferLocalBlobPreview, projectCanvasNodeAssets } from "../domain/model";
import type { StoryboardAsset } from "../domain/types";
import { canvasNodesAtom } from "./canvasGraph";

type AssetState = {
  activeShotId: string;
  /** 签名 URL、审核等可重建展示信息；key 永远是源 CanvasNodeID。 */
  detailsByNodeId: Map<string, StoryboardAsset>;
  /** 仅编辑期间存在；正式关系始终从 CanvasNode 图投影。 */
  draftsByShotId: Map<string, StoryboardAsset[]>;
};

const EMPTY: StoryboardAsset[] = [];

const assetStateAtom = atom<AssetState>({
  activeShotId: "",
  detailsByNodeId: new Map(),
  draftsByShotId: new Map(),
});
const mentionIdResolvedListenersAtom = atom(new Set<(replacements: MentionIdReplacement[]) => void>());

export const canvasAssetDetailsAtom = atom((get) => get(assetStateAtom).detailsByNodeId);

export function collectPendingAssetReviewIDs(assets: readonly StoryboardAsset[]) {
  const ids = new Set<string>();
  for (const item of assets) {
    if (!item.assetId) continue;
    const reviews = [...(item.reviews ?? []), ...(item.review ? [item.review] : [])];
    if (
      reviews.some(
        (review) =>
          review.Status === asset.AssetReviewStatus.SUBMITTING || review.Status === asset.AssetReviewStatus.PROCESSING,
      )
    ) {
      ids.add(item.assetId);
    }
  }
  return [...ids];
}

export function replaceAssetReviewSnapshots(
  assets: readonly StoryboardAsset[],
  reviewsByAssetID: ReadonlyMap<string, asset.AssetReview[]>,
) {
  return assets.map((item) => {
    if (!item.assetId || !reviewsByAssetID.has(item.assetId)) return item;
    const reviews = reviewsByAssetID.get(item.assetId) ?? [];
    return { ...item, review: latestAssetReview(reviews), reviews };
  });
}

function replaceAssetReviewsInMap(
  assets: ReadonlyMap<string, StoryboardAsset>,
  reviewsByAssetID: ReadonlyMap<string, asset.AssetReview[]>,
) {
  return new Map(
    [...assets].map(([key, item]) => [key, replaceAssetReviewSnapshots([item], reviewsByAssetID)[0] ?? item]),
  );
}

function mergeAssetReview(item: StoryboardAsset, assetId: string, review: asset.AssetReview) {
  if (item.assetId !== assetId) return item;
  const reviews = [...(item.reviews ?? []).filter((itemReview) => itemReview.PackageID !== review.PackageID), review];
  return { ...item, review: latestAssetReview(reviews), reviews };
}

export const pendingAssetReviewIDsAtom = atom((get) => {
  const state = get(assetStateAtom);
  return collectPendingAssetReviewIDs([...state.detailsByNodeId.values(), ...state.draftsByShotId.values()].flat());
});

const assetsForShot = (state: AssetState, nodes: Parameters<typeof projectCanvasNodeAssets>[0], shotId: string) =>
  state.draftsByShotId.get(shotId) ?? projectCanvasNodeAssets(nodes, shotId, state.detailsByNodeId);

/** 当前分镜素材由画布图计算；编辑草稿只在编辑会话内覆盖该投影。 */
export const activeAssetsAtom = atom((get) => {
  const state = get(assetStateAtom);
  if (!state.activeShotId) return EMPTY;
  return assetsForShot(state, get(canvasNodesAtom), state.activeShotId);
});

const collectMentionIdReplacements = (prev: readonly StoryboardAsset[], next: readonly StoryboardAsset[]) => {
  const replacements: MentionIdReplacement[] = [];
  for (const item of next) {
    if (!item.draftId || item.draftId === item.id || item.id.startsWith("draft-")) {
      continue;
    }
    const before = prev.find((candidate) => candidate.id === item.draftId || candidate.draftId === item.draftId);
    if (before && before.id !== item.id) {
      replacements.push({ assetId: item.id, draftId: item.draftId });
    }
  }
  return replacements;
};

/** 为当前 Studio Provider 中的 Jotai store 创建稳定命令门面。 */
export function useStudioAssetStore() {
  const store = useStore();

  return useMemo(() => {
    const publishMentionReplacements = (prev: readonly StoryboardAsset[], next: readonly StoryboardAsset[]) => {
      const replacements = collectMentionIdReplacements(prev, next);
      if (replacements.length) {
        store.get(mentionIdResolvedListenersAtom).forEach((listener) => listener(replacements));
      }
    };

    const getForShot = (shotId: string) => assetsForShot(store.get(assetStateAtom), store.get(canvasNodesAtom), shotId);

    return {
      getSnapshot: () => store.get(activeAssetsAtom),

      subscribe: (listener: () => void) => store.sub(activeAssetsAtom, listener),

      subscribeMentionIdResolved: (listener: (replacements: MentionIdReplacement[]) => void) => {
        const listeners = new Set(store.get(mentionIdResolvedListenersAtom));
        listeners.add(listener);
        store.set(mentionIdResolvedListenersAtom, listeners);
        return () => {
          const next = new Set(store.get(mentionIdResolvedListenersAtom));
          next.delete(listener);
          store.set(mentionIdResolvedListenersAtom, next);
        };
      },

      setActiveShot: (shotId: string) => {
        const current = store.get(assetStateAtom);
        if (current.activeShotId === shotId) return;
        store.set(assetStateAtom, { ...current, activeShotId: shotId });
      },

      cacheDetails: (assets: readonly StoryboardAsset[]) => {
        if (!assets.length) return;
        const current = store.get(assetStateAtom);
        const detailsByNodeId = new Map(current.detailsByNodeId);
        for (const item of assets) {
          const nodeId = item.canvasNodeId ?? item.id;
          if (!nodeId || nodeId.startsWith("draft-")) continue;
          const previous = detailsByNodeId.get(nodeId);
          const next = preferLocalBlobPreview(previous, item);
          detailsByNodeId.set(nodeId, {
            ...previous,
            ...next,
            id: nodeId,
            canvasNodeId: nodeId,
          });
        }
        store.set(assetStateAtom, { ...current, detailsByNodeId });
      },

      updateReview: (assetId: string, review: NonNullable<StoryboardAsset["review"]>) => {
        if (!assetId) return;
        const current = store.get(assetStateAtom);
        const detailsByNodeId = new Map(
          [...current.detailsByNodeId].map(([nodeId, item]) => [nodeId, mergeAssetReview(item, assetId, review)]),
        );
        const draftsByShotId = new Map(
          [...current.draftsByShotId].map(([shotId, assets]) => [
            shotId,
            assets.map((item) => mergeAssetReview(item, assetId, review)),
          ]),
        );
        store.set(assetStateAtom, {
          ...current,
          detailsByNodeId,
          draftsByShotId,
        });
      },

      replaceReviews: (items: readonly asset.AssetReviews[]) => {
        if (!items.length) return;
        const current = store.get(assetStateAtom);
        const reviewsByAssetID = new Map(items.map((item) => [item.AssetID, item.Reviews]));
        const detailsByNodeId = replaceAssetReviewsInMap(current.detailsByNodeId, reviewsByAssetID);
        const draftsByShotId = new Map(
          [...current.draftsByShotId].map(([shotId, assets]) => [
            shotId,
            replaceAssetReviewSnapshots(assets, reviewsByAssetID),
          ]),
        );
        store.set(assetStateAtom, {
          ...current,
          detailsByNodeId,
          draftsByShotId,
        });
      },

      beginDraft: (shotId: string) => {
        if (!shotId) return;
        const current = store.get(assetStateAtom);
        if (current.draftsByShotId.has(shotId)) return;
        const draftsByShotId = new Map(current.draftsByShotId);
        draftsByShotId.set(
          shotId,
          projectCanvasNodeAssets(store.get(canvasNodesAtom), shotId, current.detailsByNodeId),
        );
        store.set(assetStateAtom, { ...current, draftsByShotId });
      },

      updateDraft: (shotId: string, update: (current: StoryboardAsset[]) => StoryboardAsset[]) => {
        if (!shotId) return;
        const current = store.get(assetStateAtom);
        const prev = current.draftsByShotId.get(shotId);
        if (!prev) return;
        const next = update(prev);
        const draftsByShotId = new Map(current.draftsByShotId);
        draftsByShotId.set(shotId, next);
        store.set(assetStateAtom, { ...current, draftsByShotId });
        publishMentionReplacements(prev, next);
      },

      clearDraft: (shotId: string) => {
        const current = store.get(assetStateAtom);
        const draft = current.draftsByShotId.get(shotId);
        if (!draft) return;
        const detailsByNodeId = new Map(current.detailsByNodeId);
        for (const item of draft) {
          const nodeId = item.canvasNodeId;
          if (!nodeId) continue;
          const previous = detailsByNodeId.get(nodeId);
          const next = preferLocalBlobPreview(previous, item);
          detailsByNodeId.set(nodeId, {
            ...previous,
            ...next,
            id: nodeId,
            canvasNodeId: nodeId,
          });
        }
        const draftsByShotId = new Map(current.draftsByShotId);
        draftsByShotId.delete(shotId);
        store.set(assetStateAtom, {
          ...current,
          detailsByNodeId,
          draftsByShotId,
        });
      },

      getForShot,

      dropShot: (shotId: string) => {
        const current = store.get(assetStateAtom);
        if (!current.draftsByShotId.has(shotId)) return;
        const draftsByShotId = new Map(current.draftsByShotId);
        draftsByShotId.delete(shotId);
        store.set(assetStateAtom, { ...current, draftsByShotId });
      },

      listAll: () => {
        const state = store.get(assetStateAtom);
        return [...state.detailsByNodeId.values(), ...state.draftsByShotId.values()].flat();
      },

      reset: () => {
        store.set(assetStateAtom, {
          activeShotId: "",
          detailsByNodeId: new Map(),
          draftsByShotId: new Map(),
        });
      },
    };
  }, [store]);
}
