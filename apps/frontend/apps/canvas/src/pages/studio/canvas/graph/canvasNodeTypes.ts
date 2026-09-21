import { type Node } from "@xyflow/react";

import { type AssetMentionItem, type AssetMentionSource } from "@/components/promptEditor";
import type { canvasnode } from "@/domain";

import type { StoryboardAsset } from "../../domain/types";
import type { CanvasNodeStore } from "./CanvasNodeStore";
export type ContentPatch = {
  Name?: string;
  Prompt?: string;
  Text?: string;
  VideoInputMode?: canvasnode.CanvasVideoInputMode;
  GenerationConfig?: canvasnode.CanvasNodeGenerationConfigPatch;
};

export type CanvasNodeData = {
  item: canvasnode.CanvasNode;
  nodePubSub: CanvasNodeStore;
  onHistory: (item: canvasnode.CanvasNode) => void;
  onPatch: (item: canvasnode.CanvasNode, patch: ContentPatch) => Promise<canvasnode.CanvasNode>;
  queryTree: NonNullable<AssetMentionSource["queryTree"]>;
  referenceAssets: StoryboardAsset[];
  selectAsset: (asset: AssetMentionItem) => Promise<AssetMentionItem>;
  reviewAsset?: StoryboardAsset;
  previewURL?: string;
  thumbnailURL?: string;
};

export type CanvasFlowNode = Node<CanvasNodeData, "canvasNode">;
