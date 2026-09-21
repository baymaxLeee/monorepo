import { type Edge } from "@xyflow/react";

import { type GenerationModelOption } from "@/components/GenerationConfiguration";
import { canvasnode } from "@/domain";

import type { StoryboardAsset } from "../../domain/types";
import type { CanvasNodeStore } from "./CanvasNodeStore";
import type { CanvasFlowNode, CanvasNodeData, ContentPatch } from "./canvasNodeTypes";
import { CANVAS_NODE_LAYER_GAP } from "./layout";
import { type CanvasNodePortSide } from "./nodeProtocol";

import styles from "../CanvasBoard.module.less";
export const MATERIALIZED_NODE_HORIZONTAL_GAP = 80;

export function contentAssetID(item: canvasnode.CanvasNode) {
  return item.CurrentAssetID ?? item.AssetID ?? item.SelectedAssetID;
}

export function isDeletedReferenceNode(item: canvasnode.CanvasNode) {
  return item.ReferenceStatus === canvasnode.CanvasNodeReferenceStatus.DELETED;
}

export function canvasNodeClassName(item: canvasnode.CanvasNode) {
  return `${styles.node} ${
    isGenerationType(item.Type) ? styles.generationNode : styles.contentNode
  } ${isAutoSizedMediaNodeType(item.Type) ? styles.autoSizedMediaNode : ""} ${
    item.Type === canvasnode.CanvasNodeType.IMAGE_GENERATION || item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION
      ? styles.largeNode
      : item.Type === canvasnode.CanvasNodeType.AUDIO_ASSET
        ? styles.audioNode
        : ""
  } ${isDeletedReferenceNode(item) ? styles.deletedReferenceNode : ""}`;
}

export function textNodeContent(item: canvasnode.CanvasNode) {
  return item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION ? (item.SelectedOutputText ?? "") : (item.Text ?? "");
}

export function isGenerationType(type: canvasnode.CanvasNodeType) {
  return (
    type === canvasnode.CanvasNodeType.IMAGE_GENERATION ||
    type === canvasnode.CanvasNodeType.VIDEO_GENERATION ||
    type === canvasnode.CanvasNodeType.TEXT_GENERATION
  );
}

export function isAutoSizedMediaNodeType(type: canvasnode.CanvasNodeType) {
  return (
    type === canvasnode.CanvasNodeType.IMAGE_ASSET ||
    type === canvasnode.CanvasNodeType.IMAGE_GENERATION ||
    type === canvasnode.CanvasNodeType.VIDEO_ASSET ||
    type === canvasnode.CanvasNodeType.VIDEO_GENERATION
  );
}

export function isEditableNode(type: canvasnode.CanvasNodeType) {
  return type === canvasnode.CanvasNodeType.TEXT || isGenerationType(type);
}

export function modelOptionsForType(
  type: canvasnode.CanvasNodeType,
  imageModelOptions: GenerationModelOption[],
  textModelOptions: GenerationModelOption[],
  videoModelOptions: GenerationModelOption[],
) {
  if (type === canvasnode.CanvasNodeType.IMAGE_GENERATION) {
    return imageModelOptions;
  }
  if (type === canvasnode.CanvasNodeType.TEXT_GENERATION) {
    return textModelOptions;
  }
  return videoModelOptions;
}

export function editableContent(item: canvasnode.CanvasNode) {
  return item.Type === canvasnode.CanvasNodeType.TEXT ? (item.Text ?? "") : item.Prompt;
}

export function contentPatch(item: canvasnode.CanvasNode, content: string): ContentPatch {
  return item.Type === canvasnode.CanvasNodeType.TEXT ? { Text: content } : { Prompt: content };
}

export function dtoToNode(
  item: canvasnode.CanvasNode,
  nodePubSub: CanvasNodeStore,
  onHistory: CanvasNodeData["onHistory"],
  onPatch: CanvasNodeData["onPatch"],
  queryTree: CanvasNodeData["queryTree"],
  selectAsset: CanvasNodeData["selectAsset"],
  previewURL?: string,
  thumbnailURL?: string,
  referenceAssets: StoryboardAsset[] = [],
  reviewAsset?: StoryboardAsset,
): CanvasFlowNode {
  return {
    id: item.NodeID,
    type: "canvasNode",
    className: canvasNodeClassName(item),
    dragHandle: ".canvas-node-drag-handle",
    position: { x: item.Position.PositionX, y: item.Position.PositionY },
    data: {
      item,
      nodePubSub,
      onHistory,
      onPatch,
      queryTree,
      referenceAssets,
      reviewAsset,
      selectAsset,
      previewURL,
      thumbnailURL,
    },
  };
}

export function dtoToEdges(items: canvasnode.CanvasNode[]): Edge[] {
  return items.flatMap((target) =>
    target.IncomingEdges.map((edge) => ({
      id: edge.EdgeID,
      source: edge.SourceNodeID,
      target: target.NodeID,
      sourceHandle: "output",
      targetHandle: "input",
    })),
  );
}

export type AddMenu = {
  clientX: number;
  clientY: number;
  flowX: number;
  flowY: number;
  quickConnection?: {
    anchorNodeID: string;
    side: CanvasNodePortSide;
  };
  types?: readonly canvasnode.CanvasNodeType[];
};

// React Flow 持久化节点左上角坐标；尺寸与 CanvasBoard.module.less 保持一致。
export const CANVAS_NODE_WIDTH = 300;
export const CANVAS_NODE_DEFAULT_HEIGHT = 201;
export const CANVAS_NODE_LARGE_HEIGHT = 332;

export function canvasNodeHeight(type: canvasnode.CanvasNodeType) {
  return type === canvasnode.CanvasNodeType.IMAGE_GENERATION || type === canvasnode.CanvasNodeType.VIDEO_GENERATION
    ? CANVAS_NODE_LARGE_HEIGHT
    : CANVAS_NODE_DEFAULT_HEIGHT;
}

export function nodePositionFromAnchor(type: canvasnode.CanvasNodeType, anchor: Pick<AddMenu, "flowX" | "flowY">) {
  const height = canvasNodeHeight(type);
  return {
    flowX: anchor.flowX - CANVAS_NODE_WIDTH / 2,
    flowY: anchor.flowY - height / 2,
  };
}

export function nodePositionFromQuickConnection(
  type: canvasnode.CanvasNodeType,
  anchor: CanvasFlowNode,
  side: CanvasNodePortSide,
) {
  const anchorWidth = anchor.measured?.width ?? CANVAS_NODE_WIDTH;
  const anchorHeight = anchor.measured?.height ?? canvasNodeHeight(anchor.data.item.Type);
  return {
    flowX:
      side === "output"
        ? anchor.position.x + anchorWidth + CANVAS_NODE_LAYER_GAP
        : anchor.position.x - CANVAS_NODE_WIDTH - CANVAS_NODE_LAYER_GAP,
    flowY: anchor.position.y + (anchorHeight - canvasNodeHeight(type)) / 2,
  };
}

export { ARRANGE_CANVAS_SHORTCUT, POINTER_SHORTCUT_TOKENS } from "../controls/shortcuts";
export type { CanvasInteractionMode, ShortcutItem, ShortcutGroup } from "../controls/shortcuts";
import { ARRANGE_CANVAS_SHORTCUT } from "../controls/shortcuts";

export function matchesArrangeCanvasShortcut(event: KeyboardEvent) {
  const { modifiers } = ARRANGE_CANVAS_SHORTCUT;
  return (
    event.code === ARRANGE_CANVAS_SHORTCUT.code &&
    event.altKey === modifiers.altKey &&
    event.ctrlKey === modifiers.ctrlKey &&
    event.metaKey === modifiers.metaKey &&
    event.shiftKey === modifiers.shiftKey
  );
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('input, textarea, select, [contenteditable="true"], .ProseMirror'))
  );
}
