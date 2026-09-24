import { toast } from "@repo/design-system";
import type { SuggestionProps } from "@tiptap/suggestion";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";

import { type asset, asset as assetIDL } from "@/domain";

import { AddAssetToLibraryDialog } from "./AddAssetToLibraryDialog";
import { AssetPreviewCard, POPUP_SURFACE } from "./AssetPreviewCard";
import { MentionListColumn } from "./MentionListColumn";
import {
  ASSETS_ROOT_ID,
  NODES_ROOT_ID,
  REFERENCES_ROOT_ID,
  collectMentionNodes,
  mentionNodeToAsset,
  projectMentionGroupIds,
  unavailableAssetMessage,
} from "./mentionTree";
import type { AssetMentionItem, AssetMentionSource, AssetQueryDataSource, MentionNode } from "./types";

export const SUGGESTION_LIST_WIDTH = 260;
export const SUGGESTION_PANEL_HEIGHT = 532;
export const PREVIEW_POPUP_CLASS = "asset-preview-popup";

const nodeID = (node: MentionNode) => node.DraftID ?? node.ID;

export interface AssetSuggestionListProps extends SuggestionProps<AssetMentionItem, AssetMentionItem> {
  dataSource: AssetQueryDataSource;
  onClose: () => void;
  onReview?: (asset: AssetMentionItem, onUpdated: (review: asset.AssetReview) => void) => void;
  onAddToLibrary?: NonNullable<AssetMentionSource["addToLibrary"]>;
}

export interface AssetSuggestionListRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const AssetSuggestionList = forwardRef<AssetSuggestionListRef, AssetSuggestionListProps>(
  ({ command, dataSource, onClose, onReview, onAddToLibrary }, ref) => {
    const [queryState, setQueryState] = useState(dataSource.getState);
    const [selectedRoot, setSelectedRoot] = useState<MentionNode>();
    const [selectedChild, setSelectedChild] = useState<MentionNode>();
    const [reviewOverrides, setReviewOverrides] = useState<Record<string, asset.AssetReview>>({});
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
    const [expandedSectionIds, setExpandedSectionIds] = useState<Set<string>>(
      new Set([REFERENCES_ROOT_ID, NODES_ROOT_ID, ASSETS_ROOT_ID]),
    );
    const [libraryAsset, setLibraryAsset] = useState<AssetMentionItem>();
    const [rightPanelTop, setRightPanelTop] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);
    const rootNodesRef = useRef<MentionNode[]>([]);

    const items = useMemo(() => {
      const applyReview = (node: MentionNode): MentionNode => ({
        ...node,
        Children: node.Children.map(applyReview),
        Review:
          node.Review?.Status === assetIDL.AssetReviewStatus.APPROVED ||
          node.Review?.Status === assetIDL.AssetReviewStatus.FAILED
            ? node.Review
            : (reviewOverrides[node.AssetID ?? node.ID] ?? node.Review),
      });
      return queryState.items.map(applyReview);
    }, [queryState.items, reviewOverrides]);
    const referencesRoot = items.find((root) => root.ID === REFERENCES_ROOT_ID);
    const nodesRoot = items.find((root) => root.ID === NODES_ROOT_ID);
    const assetsRoot = items.find((root) => root.ID === ASSETS_ROOT_ID);
    const groupIds = useMemo(() => projectMentionGroupIds(assetsRoot?.Children ?? []), [assetsRoot]);
    const temporaryIds = useMemo(
      () => new Set([...(referencesRoot?.Children.map(nodeID) ?? []), ...(nodesRoot?.Children.map(nodeID) ?? [])]),
      [nodesRoot, referencesRoot],
    );
    const rootNodes = useMemo(() => items.flatMap((root) => root.Children), [items]);
    rootNodesRef.current = rootNodes;
    const activeNode = selectedChild ?? selectedRoot;
    const previewNode =
      activeNode &&
      items.some(
        (section) =>
          expandedSectionIds.has(section.ID) &&
          section.Children.some(
            (node) =>
              nodeID(node) === nodeID(activeNode) ||
              node.Children.some((child) => nodeID(child) === nodeID(activeNode)),
          ),
      )
        ? activeNode
        : undefined;
    const activeRootId = selectedRoot ? nodeID(selectedRoot) : undefined;
    const activeChildId = selectedChild ? nodeID(selectedChild) : undefined;
    const activeId =
      selectedRoot && groupIds.has(selectedRoot.ID) && !expandedIds.has(selectedRoot.ID)
        ? activeRootId
        : (activeChildId ?? activeRootId);
    const visibleNodes = useMemo(
      () =>
        items.flatMap((section) =>
          expandedSectionIds.has(section.ID)
            ? section.Children.flatMap((node) =>
                groupIds.has(node.ID) && expandedIds.has(node.ID) ? [node, ...node.Children] : [node],
              )
            : [],
        ),
      [expandedIds, expandedSectionIds, groupIds, items],
    );
    const empty = !queryState.loading && rootNodes.length === 0;
    const sourceOf = (node: MentionNode): AssetMentionItem["source"] =>
      temporaryIds.has(nodeID(node)) ? "canvasnode" : "project";

    useEffect(() => dataSource.subscribe(() => setQueryState(dataSource.getState())), [dataSource]);

    useEffect(() => {
      const reviews = collectMentionNodes(items).map((node) => node.Review);
      if (
        !reviews.some(
          (review) =>
            review?.Status === assetIDL.AssetReviewStatus.SUBMITTING ||
            review?.Status === assetIDL.AssetReviewStatus.PROCESSING,
        )
      ) {
        return;
      }
      const timer = window.setInterval(dataSource.refresh, 5000);
      return () => window.clearInterval(timer);
    }, [dataSource, items]);

    useEffect(() => {
      if (queryState.loading) return;
      const first = rootNodesRef.current[0];
      setExpandedIds(new Set());
      setExpandedSectionIds(new Set([REFERENCES_ROOT_ID, NODES_ROOT_ID, ASSETS_ROOT_ID]));
      setSelectedRoot(first);
      setSelectedChild(undefined);
    }, [queryState.loading, queryState.query]);

    useEffect(() => {
      if (queryState.loading) return;
      const currentRoots = rootNodesRef.current;
      setSelectedRoot((current) =>
        current ? (currentRoots.find((node) => nodeID(node) === nodeID(current)) ?? currentRoots[0]) : currentRoots[0],
      );
      setSelectedChild((current) =>
        current
          ? currentRoots.flatMap((node) => node.Children).find((node) => nodeID(node) === nodeID(current))
          : undefined,
      );
    }, [items, queryState.loading]);

    const selectNode = (node: MentionNode) => {
      const selected = mentionNodeToAsset(node, sourceOf(node));
      const unavailable = unavailableAssetMessage(selected);
      if (unavailable) {
        toast.add({
          type: "warning",
          title: unavailable,
        });
        return;
      }
      command(selected);
    };
    const handleHover = (node: MentionNode, element?: HTMLElement) => {
      if (element) {
        const top = element.offsetTop - (listRef.current?.scrollTop ?? 0);
        setRightPanelTop(Math.max(0, top));
      }
      if (groupIds.has(node.ID)) {
        setSelectedRoot(node);
        setSelectedChild(undefined);
        return;
      }
      const parent = rootNodes.find(
        (candidate) => groupIds.has(candidate.ID) && candidate.Children.some((child) => nodeID(child) === nodeID(node)),
      );
      setSelectedRoot(parent ?? node);
      setSelectedChild(parent ? node : undefined);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return true;
      }
      if (!visibleNodes.length && event.key !== "ArrowLeft") return false;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const index = Math.max(
          visibleNodes.findIndex((node) => nodeID(node) === activeId),
          0,
        );
        const next =
          visibleNodes[
            event.key === "ArrowDown"
              ? (index + 1) % visibleNodes.length
              : (index + visibleNodes.length - 1) % visibleNodes.length
          ];
        handleHover(next);
        return true;
      }
      if (event.key === "ArrowRight" && selectedRoot && groupIds.has(selectedRoot.ID)) {
        setExpandedIds((current) => new Set(current).add(selectedRoot.ID));
        return true;
      }
      if (event.key === "ArrowLeft") {
        if (selectedRoot && groupIds.has(selectedRoot.ID)) {
          setSelectedChild(undefined);
          setExpandedIds((current) => {
            const next = new Set(current);
            next.delete(selectedRoot.ID);
            return next;
          });
        }
        return true;
      }
      if (event.key === "Enter") {
        if (!previewNode) return true;
        if (selectedChild) selectNode(selectedChild);
        else if (selectedRoot && groupIds.has(selectedRoot.ID)) {
          setExpandedIds((current) => {
            const next = new Set(current);
            if (next.has(selectedRoot.ID)) next.delete(selectedRoot.ID);
            else next.add(selectedRoot.ID);
            return next;
          });
        } else if (selectedRoot) selectNode(selectedRoot);
        return true;
      }
      return false;
    };

    useImperativeHandle(ref, () => ({ onKeyDown: handleKeyDown }));

    useEffect(() => {
      if (!activeId) return;
      listRef.current
        ?.querySelector<HTMLElement>(`[data-mention-id="${activeId}"]`)
        ?.scrollIntoView({ block: "nearest" });
    }, [activeId]);

    const previewGroup = previewNode && groupIds.has(previewNode.ID) ? previewNode : undefined;
    const previewAsset = (() => {
      if (previewGroup) {
        const primary = previewGroup.Children.find((child) => child.URL === previewGroup.URL);
        if (primary) {
          return {
            ...mentionNodeToAsset(primary, "project"),
            description: previewGroup.Description,
            previewUrl: previewGroup.URL,
            thumbnail: primary.MediaType === assetIDL.AssetMediaType.IMAGE ? previewGroup.URL : undefined,
            title: previewGroup.Label,
          };
        }
      }
      return previewNode ? mentionNodeToAsset(previewNode, sourceOf(previewNode)) : undefined;
    })();
    return (
      <div className="flex items-start gap-2" data-canvas-editor-overlay>
        <div
          className={`shrink-0 overflow-hidden ${POPUP_SURFACE}`}
          style={{
            width: SUGGESTION_LIST_WIDTH,
            maxHeight: SUGGESTION_PANEL_HEIGHT,
          }}
        >
          <div className="min-w-0 w-full">
            <MentionListColumn
              activeId={activeId}
              empty={empty}
              expandedIds={expandedIds}
              expandedSectionIds={expandedSectionIds}
              groupIds={groupIds}
              hasMore={Boolean(queryState.nextCursor)}
              listRef={listRef}
              maxHeight={SUGGESTION_PANEL_HEIGHT}
              loading={queryState.loading}
              loadingMore={queryState.loadingMore}
              onHover={handleHover}
              onLoadMore={dataSource.loadMore}
              onSelect={selectNode}
              onToggle={(node) => {
                setSelectedRoot(node);
                setSelectedChild(undefined);
                setExpandedIds((current) => {
                  const next = new Set(current);
                  if (next.has(node.ID)) next.delete(node.ID);
                  else next.add(node.ID);
                  return next;
                });
              }}
              onToggleSection={(section) =>
                setExpandedSectionIds((current) => {
                  const next = new Set(current);
                  if (next.has(section.ID)) next.delete(section.ID);
                  else next.add(section.ID);
                  return next;
                })
              }
              query={queryState.query}
              sections={items}
            />
          </div>
        </div>
        {previewAsset && !unavailableAssetMessage(previewAsset) ? (
          <div
            className={PREVIEW_POPUP_CLASS}
            style={{
              transform: previewAsset.category === "audio" ? `translateY(${rightPanelTop}px)` : undefined,
            }}
          >
            <AssetPreviewCard
              asset={previewAsset}
              onAddToLibrary={
                onAddToLibrary &&
                previewAsset.source === "canvasnode" &&
                Boolean(previewAsset.assetId) &&
                !previewAsset.id.startsWith("draft-") &&
                previewAsset.category !== "video" &&
                previewAsset.category !== "text"
                  ? setLibraryAsset
                  : undefined
              }
              onSubmitReview={
                onReview && previewAsset.category !== "text" && previewAsset.assetId
                  ? (current) =>
                      onReview(current, (review) =>
                        setReviewOverrides((values) => ({
                          ...values,
                          [current.assetId ?? current.id]: review,
                        })),
                      )
                  : undefined
              }
            />
          </div>
        ) : null}
        {onAddToLibrary ? (
          <AddAssetToLibraryDialog
            asset={libraryAsset}
            onClose={() => setLibraryAsset(undefined)}
            onSubmit={async (current, input) => {
              await onAddToLibrary(current, input);
              dataSource.refresh();
            }}
          />
        ) : null}
      </div>
    );
  },
);

AssetSuggestionList.displayName = "AssetSuggestionList";
