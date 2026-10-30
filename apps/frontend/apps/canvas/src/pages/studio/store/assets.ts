import { atom, useStore } from "jotai";
import { createContext, createElement, useContext, useMemo, useSyncExternalStore, type ReactNode } from "react";

import type { MentionIdReplacement } from "@/components/promptEditor";

import { assetFromCanvasNode, projectCanvasNodeAssets } from "../domain/model";
import type { StoryboardAsset } from "../domain/types";
import { canvasNodesAtom } from "./canvasGraph";

/** Formal asset identities, URLs and reviews are derived from the SSE projection. */
export const canvasAssetDetailsAtom = atom(
  (get) => new Map(get(canvasNodesAtom).map((node) => [node.NodeID, assetFromCanvasNode(node)])),
);

type Store = ReturnType<typeof useStore>;
function createAssetDraftSession(store: Store) {
  let activeShotId = "";
  const drafts = new Map<string, StoryboardAsset[]>();
  const listeners = new Set<() => void>();
  const mentionListeners = new Set<(changes: MentionIdReplacement[]) => void>();
  let version = 0;
  let cached: { nodes: ReturnType<Store["get"]>; version: number; items: StoryboardAsset[] } | undefined;
  const notify = () => {
    version++;
    listeners.forEach((listener) => listener());
  };
  const getForShot = (id: string) => {
    const nodes = store.get(canvasNodesAtom);
    const draft = drafts.get(id);
    if (!draft) return projectCanvasNodeAssets(nodes, id);
    const byId = new Map(nodes.map((node) => [node.NodeID, node]));
    // Drafts own membership/port changes, never a stale copy of server media or reviews.
    return draft.flatMap((item) => {
      if (!item.canvasNodeId) return [item];
      const node = byId.get(item.canvasNodeId);
      return node
        ? [{ ...item, ...assetFromCanvasNode(node), draftId: item.draftId, targetPort: item.targetPort }]
        : [];
    });
  };
  const getSnapshot = () => {
    const nodes = store.get(canvasNodesAtom);
    if (!cached || cached.nodes !== nodes || cached.version !== version)
      cached = { nodes, version, items: activeShotId ? getForShot(activeShotId) : [] };
    return cached.items;
  };
  return {
    getSnapshot,
    getForShot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      const stop = store.sub(canvasNodesAtom, listener);
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
    subscribeMentionIdResolved: (listener: (changes: MentionIdReplacement[]) => void) => {
      mentionListeners.add(listener);
      return () => {
        mentionListeners.delete(listener);
      };
    },
    setActiveShot: (id: string) => {
      if (activeShotId !== id) {
        activeShotId = id;
        notify();
      }
    },
    beginDraft: (id: string) => {
      if (id && !drafts.has(id)) {
        drafts.set(id, getForShot(id));
        notify();
      }
    },
    updateDraft: (id: string, update: (items: StoryboardAsset[]) => StoryboardAsset[]) => {
      if (!drafts.has(id)) return;
      const before = getForShot(id),
        next = update(before);
      drafts.set(id, next);
      const changes = next.flatMap((item) =>
        item.draftId &&
        item.draftId !== item.id &&
        !item.id.startsWith("draft-") &&
        before.some((old) => old.id === item.draftId)
          ? [{ assetId: item.id, draftId: item.draftId }]
          : [],
      );
      notify();
      if (changes.length) mentionListeners.forEach((listener) => listener(changes));
    },
    clearDraft: (id: string) => {
      if (drafts.delete(id)) notify();
    },
    dropShot: (id: string) => {
      if (drafts.delete(id)) notify();
    },
    listAll: () => [...drafts.values()].flat(),
    reset: () => {
      drafts.clear();
      activeShotId = "";
      notify();
    },
  };
}
const AssetDraftContext = createContext<ReturnType<typeof createAssetDraftSession> | undefined>(undefined);
/** The editor owns temporary upload/relationship drafts; unmount discards the session. */
export function AssetDraftProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const session = useMemo(() => createAssetDraftSession(store), [store]);
  return createElement(AssetDraftContext.Provider, { value: session }, children);
}
export function useStudioAssetStore() {
  const session = useContext(AssetDraftContext);
  if (!session) throw new Error("Missing asset draft session");
  return session;
}
export function useActiveAssets() {
  const session = useStudioAssetStore();
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
