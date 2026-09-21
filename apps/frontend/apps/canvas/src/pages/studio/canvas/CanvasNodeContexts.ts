import { createContext } from "react";

import { type AssetMentionSource } from "@/components/promptEditor";
import type { canvasnode } from "@/domain";

import { type CanvasNodePortSide } from "./graph/nodeProtocol";
export type CanvasContentActionsContextValue = {
  addToLibrary: (item: canvasnode.CanvasNode) => void;
  copy: (item: canvasnode.CanvasNode) => void;
  review: (item: canvasnode.CanvasNode) => void;
  reviewAsset: NonNullable<AssetMentionSource["review"]>;
};

export const CanvasContentActionsContext = createContext<CanvasContentActionsContextValue>({
  addToLibrary: () => undefined,
  copy: () => undefined,
  review: () => undefined,
  reviewAsset: () => undefined,
});

export const TextGenerationWaitingContext = createContext<ReadonlySet<string>>(new Set());

export type CanvasQuickCreateContextValue = {
  open: (item: canvasnode.CanvasNode, side: CanvasNodePortSide, event: React.MouseEvent) => void;
};

export const CanvasQuickCreateContext = createContext<CanvasQuickCreateContextValue>({
  open: () => undefined,
});

export type CanvasEditingContextValue = {
  projectId?: string;
  cancel: (item: canvasnode.CanvasNode) => void;
  changeDraft: (draft: string) => void;
  close: () => void;
  collapseLargeTextEditor: () => void;
  collapseLargeTextPreview: () => void;
  editingNodeId: string;
  generate: (item: canvasnode.CanvasNode) => void;
  getDraft: () => string;
  largeTextEditorNodeId: string;
  largeTextPreviewNodeId: string;
  openLargeTextPreview: (nodeId: string) => void;
  retry: (item: canvasnode.CanvasNode) => void;
  save?: () => Promise<void>;
  saving: boolean;
  swapFrames: (item: canvasnode.CanvasNode) => void;
};

export const CanvasEditingContext = createContext<CanvasEditingContextValue>({
  cancel: () => undefined,
  changeDraft: () => undefined,
  close: () => undefined,
  collapseLargeTextEditor: () => undefined,
  collapseLargeTextPreview: () => undefined,
  editingNodeId: "",
  generate: () => undefined,
  getDraft: () => "",
  largeTextEditorNodeId: "",
  largeTextPreviewNodeId: "",
  openLargeTextPreview: () => undefined,
  retry: () => undefined,
  saving: false,
  swapFrames: () => undefined,
});
