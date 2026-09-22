import { asset, canvasnode, resource } from "@/domain";
import { latestAssetReview } from "@/utils/assetReview";

import type { AssetMentionItem, MentionNode, MentionReferenceType, MentionResourceType } from "./types";

export const REFERENCES_ROOT_ID = "references";
export const NODES_ROOT_ID = "nodes";
export const ASSETS_ROOT_ID = "assets";

export const isAssetNode = (node: MentionNode) => node.MediaType !== undefined || node.CanvasNodeID !== undefined;
export const isBlobUrl = (url?: string): url is string => Boolean(url?.startsWith("blob:"));

export const projectMentionGroupIds = (nodes: readonly MentionNode[]) =>
  new Set(nodes.filter((node) => node.Children.length > 0).map((node) => node.ID));

export const MENTION_REFERENCE_TYPE_CODE = {
  asset: 1,
  resource: 2,
  resourceAsset: 3,
  canvasNode: 4,
} as const satisfies Record<MentionReferenceType, number>;

const REFERENCE_TYPE_BY_CODE: Readonly<Record<number, MentionReferenceType>> = {
  1: "asset",
  2: "resource",
  3: "resourceAsset",
  4: "canvasNode",
};

const RESOURCE_TYPE_BY_CODE: Readonly<Record<number, MentionResourceType>> = {
  [resource.ResourceType.CHARACTER]: "character",
  [resource.ResourceType.SCENE]: "scene",
  [resource.ResourceType.PROP]: "prop",
  [resource.ResourceType.AUDIO]: "audio",
};

const RESOURCE_TYPE_CODE_BY_NAME: Readonly<Record<MentionResourceType, resource.ResourceType>> = {
  character: resource.ResourceType.CHARACTER,
  scene: resource.ResourceType.SCENE,
  prop: resource.ResourceType.PROP,
  audio: resource.ResourceType.AUDIO,
};

export type MentionReferenceIdentity =
  | { kind: "asset"; ReferenceType: 1; AssetID: string }
  | { kind: "resource"; ReferenceType: 2; ResourceID: string }
  | {
      kind: "resourceAsset";
      ReferenceType: 3;
      ResourceAssetID: string;
    }
  | { kind: "canvasNode"; ReferenceType: 4; CanvasNodeID: string };

export function mentionReferenceIdentity(item: AssetMentionItem): MentionReferenceIdentity | undefined {
  switch (item.referenceType) {
    case "asset": {
      const assetId = item.assetId?.trim();
      return assetId ? { kind: "asset", ReferenceType: 1, AssetID: assetId } : undefined;
    }
    case "resource": {
      const resourceId = item.resourceId?.trim();
      return resourceId ? { kind: "resource", ReferenceType: 2, ResourceID: resourceId } : undefined;
    }
    case "resourceAsset": {
      const resourceAssetId = item.resourceAssetId?.trim();
      return resourceAssetId
        ? {
            kind: "resourceAsset",
            ReferenceType: 3,
            ResourceAssetID: resourceAssetId,
          }
        : undefined;
    }
    case "canvasNode": {
      const canvasNodeId = item.canvasNodeId?.trim();
      return canvasNodeId
        ? {
            kind: "canvasNode",
            ReferenceType: 4,
            CanvasNodeID: canvasNodeId,
          }
        : undefined;
    }
    default:
      return undefined;
  }
}

function mentionNodeReferenceType(node: MentionNode): MentionReferenceType | undefined {
  return node.ReferenceType === undefined ? undefined : REFERENCE_TYPE_BY_CODE[node.ReferenceType];
}

const mediaCategory = (
  mediaType: asset.AssetMediaType | undefined,
  nodeType?: canvasnode.CanvasNodeType,
): AssetMentionItem["category"] =>
  nodeType === canvasnode.CanvasNodeType.TEXT || nodeType === canvasnode.CanvasNodeType.TEXT_GENERATION
    ? "text"
    : mediaType === asset.AssetMediaType.VIDEO
      ? "video"
      : mediaType === asset.AssetMediaType.AUDIO
        ? "audio"
        : "image";

export function mentionNodeToAsset(node: MentionNode, source?: AssetMentionItem["source"]): AssetMentionItem {
  const category = mediaCategory(node.MediaType, node.NodeType);
  return {
    available: node.Available,
    generating: node.Generating,
    assetId: node.AssetID,
    referenceType: mentionNodeReferenceType(node),
    resourceType: node.ResourceType === undefined ? undefined : RESOURCE_TYPE_BY_CODE[node.ResourceType],
    resourceId: node.ResourceID,
    resourceAssetId: node.ResourceAssetID,
    canvasNodeId: node.CanvasNodeID,
    category,
    description: node.Description,
    draftId: node.DraftID,
    id: node.ID,
    previewUrl: node.URL,
    review: node.Review ?? latestAssetReview(node.Reviews),
    reviews: node.Reviews,
    source,
    thumbnail: category === "image" ? node.URL : undefined,
    title: node.Label,
  };
}

function localMentionNode(item: AssetMentionItem): MentionNode {
  return {
    Children: [],
    Description: item.description,
    DraftID: item.draftId,
    ID: item.id,
    Label: item.title,
    AssetID: item.assetId,
    ResourceID: item.resourceId,
    ResourceAssetID: item.resourceAssetId,
    CanvasNodeID: item.canvasNodeId,
    ReferenceType: item.referenceType ? MENTION_REFERENCE_TYPE_CODE[item.referenceType] : undefined,
    ResourceType: item.resourceType ? RESOURCE_TYPE_CODE_BY_NAME[item.resourceType] : undefined,
    MediaType:
      item.category === "video"
        ? asset.AssetMediaType.VIDEO
        : item.category === "audio"
          ? asset.AssetMediaType.AUDIO
          : item.category === "text"
            ? undefined
            : asset.AssetMediaType.IMAGE,
    Review: item.review,
    Reviews: item.reviews,
    URL: item.previewUrl,
  };
}

export function localMentionNodes(items: readonly AssetMentionItem[], query: string): MentionNode[] {
  return items
    .filter((item) => item.id.startsWith("draft-") || item.draftId?.startsWith("draft-"))
    .filter((item) => item.source !== "project")
    .filter((item) => assetMatchesQuery(item, query))
    .map(localMentionNode);
}

export function collectMentionNodes(items: readonly MentionNode[]) {
  const result: MentionNode[] = [];
  const visit = (node: MentionNode) => {
    if (isAssetNode(node)) {
      result.push(node);
      return;
    }
    node.Children.forEach(visit);
  };
  items.forEach(visit);
  return result;
}

export function collectMentionAssets(items: readonly MentionNode[]) {
  return items.flatMap((root) => {
    const source =
      root.ID === REFERENCES_ROOT_ID || root.ID === NODES_ROOT_ID ? ("canvasnode" as const) : ("project" as const);
    return collectMentionNodes(root.Children).map((node) => mentionNodeToAsset(node, source));
  });
}

export function appendMentionTrees(current: MentionNode[], incoming: MentionNode[]) {
  const result = current.map((root) => ({
    ...root,
    Children: [...root.Children],
  }));
  for (const root of incoming) {
    const target = result.find((item) => item.ID === root.ID);
    if (!target) {
      result.push(root);
      continue;
    }
    target.Children.push(
      ...root.Children.filter((child) => !target.Children.some((existing) => existing.ID === child.ID)),
    );
  }
  return result;
}

function sameMentionIdentity(left: MentionNode, right: MentionNode) {
  return left.ID === right.ID || left.DraftID === right.ID || right.DraftID === left.ID;
}

export function mergeLocalMentionNodes(items: MentionNode[], locals: MentionNode[]): MentionNode[] {
  if (!locals.length) return items;
  const result = items.map((root) => ({
    ...root,
    Children: [...root.Children],
  }));
  let canvasnodeRoot = result.find((root) => root.ID === REFERENCES_ROOT_ID);
  if (!canvasnodeRoot) {
    canvasnodeRoot = {
      Children: [],
      ID: REFERENCES_ROOT_ID,
      Label: "引用",
    };
    result.unshift(canvasnodeRoot);
  }
  canvasnodeRoot.Children.push(
    ...locals.filter((node) => !canvasnodeRoot.Children.some((existing) => sameMentionIdentity(existing, node))),
  );
  return result;
}

export function overlayLocalBlobPreviews(items: MentionNode[], locals: readonly AssetMentionItem[]): MentionNode[] {
  const overlay = (node: MentionNode): MentionNode => {
    if (!isAssetNode(node)) {
      return { ...node, Children: node.Children.map(overlay) };
    }
    const local = locals.find(
      (candidate) => candidate.id === node.ID || candidate.draftId === node.ID || node.DraftID === candidate.id,
    );
    if (!local) return node;
    return {
      ...node,
      DraftID: local.draftId ?? node.DraftID,
      ID: local.id,
      URL: local.previewUrl?.startsWith("blob:") ? local.previewUrl : node.URL,
    };
  };
  return items.map(overlay);
}

export function assetMatchesQuery(assetItem: AssetMentionItem, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return !normalized || `${assetItem.title} ${assetItem.description ?? ""}`.toLocaleLowerCase().includes(normalized);
}

export function splitHighlight(text: string, query: string): Array<{ match: boolean; text: string }> {
  const needle = query.trim();
  if (!needle) return [{ match: false, text }];
  const lower = text.toLocaleLowerCase();
  const normalized = needle.toLocaleLowerCase();
  const parts: Array<{ match: boolean; text: string }> = [];
  let start = 0;
  while (start < text.length) {
    const index = lower.indexOf(normalized, start);
    if (index < 0) {
      parts.push({ match: false, text: text.slice(start) });
      break;
    }
    if (index > start) parts.push({ match: false, text: text.slice(start, index) });
    parts.push({ match: true, text: text.slice(index, index + needle.length) });
    start = index + normalized.length;
  }
  return parts;
}

export function unavailableAssetMessage(item: AssetMentionItem) {
  if (item.available !== false) return undefined;
  return item.generating ? "当前素材生成中，暂不可用" : "当前素材暂无可用产物，请先生成或上传";
}
