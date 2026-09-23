import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { canvasnode } from "@/domain";

import { useStudioAssetStore } from "../../store/assets";
import type { CanvasEditingContextValue } from "../CanvasNodeContexts";
import { contentPatch, editableContent, isDeletedReferenceNode } from "../graph/canvasNodeHelpers";
import type { CanvasFlowNode, CanvasNodeData } from "../graph/canvasNodeTypes";

export function useCanvasEditor({
  projectId,
  nodes,
  graphNodes,
  patchNode,
  generateNode,
  cancelNodeGeneration,
  swapNodeFrames,
}: {
  projectId?: string;
  nodes: CanvasFlowNode[];
  graphNodes: canvasnode.CanvasNode[];
  patchNode: CanvasNodeData["onPatch"];
  generateNode: (item: canvasnode.CanvasNode) => Promise<void>;
  cancelNodeGeneration: (item: canvasnode.CanvasNode) => Promise<void>;
  swapNodeFrames: (item: canvasnode.CanvasNode) => Promise<void>;
}) {
  const assetStore = useStudioAssetStore();
  const [editingNodeId, setEditingNodeId] = useState("");
  const [largeTextEditorNodeId, setLargeTextEditorNodeId] = useState("");
  const [largeTextPreviewNodeId, setLargeTextPreviewNodeId] = useState("");
  const [editorSaving, setEditorSaving] = useState(false);
  const frameSwapRef = useRef<Promise<void> | undefined>(undefined);
  const editingItemRef = useRef<canvasnode.CanvasNode | undefined>(undefined);
  const editingDraftRef = useRef("");
  const editorClosingRef = useRef<Promise<boolean> | undefined>(undefined);
  const editorRequestRef = useRef(0);

  useEffect(() => {
    const deletedNodeIDs = new Set(graphNodes.filter(isDeletedReferenceNode).map((item) => item.NodeID));
    if (editingNodeId && deletedNodeIDs.has(editingNodeId)) {
      editingItemRef.current = undefined;
      editingDraftRef.current = "";
      setEditingNodeId("");
      setLargeTextEditorNodeId("");
    }
  }, [editingNodeId, graphNodes]);

  const saveEditingNode = useCallback(async () => {
    const item = editingItemRef.current;
    if (!item) return undefined;
    const draft = editingDraftRef.current;
    if (draft === editableContent(item)) return item;
    const updated = await patchNode(item, contentPatch(item, draft));
    editingItemRef.current = updated;
    return updated;
  }, [patchNode]);

  const saveWithoutClosing = useCallback(async () => {
    if (editorSaving) return;
    setEditorSaving(true);
    try {
      await frameSwapRef.current;
      await saveEditingNode();
    } finally {
      setEditorSaving(false);
    }
  }, [editorSaving, saveEditingNode]);

  const closeEditingSession = useCallback(async () => {
    if (editorClosingRef.current) return editorClosingRef.current;
    const item = editingItemRef.current;
    if (!item) return true;

    setEditorSaving(true);
    const closing = (async () => {
      try {
        await frameSwapRef.current;
        await saveEditingNode();
        editingItemRef.current = undefined;
        editingDraftRef.current = "";
        setEditingNodeId("");
        setLargeTextEditorNodeId("");
        return true;
      } catch {
        return false;
      } finally {
        setEditorSaving(false);
      }
    })();
    editorClosingRef.current = closing;
    const closed = await closing;
    if (editorClosingRef.current === closing) {
      editorClosingRef.current = undefined;
    }
    return closed;
  }, [saveEditingNode]);

  const closeEditor = useCallback(() => {
    // Explicit dismissal supersedes any editor switch waiting for a save.
    editorRequestRef.current += 1;
    return closeEditingSession();
  }, [closeEditingSession]);

  const openEditor = useCallback(
    async (item: canvasnode.CanvasNode) => {
      if (isDeletedReferenceNode(item)) return;
      const request = ++editorRequestRef.current;
      const pendingClose = editorClosingRef.current;
      if (pendingClose && !(await pendingClose)) return;
      if (request !== editorRequestRef.current) return;
      if (editingItemRef.current?.NodeID === item.NodeID) return;
      if (editingItemRef.current && !(await closeEditingSession())) return;
      if (request !== editorRequestRef.current) return;
      editingItemRef.current = item;
      editingDraftRef.current = editableContent(item);
      setEditingNodeId(item.NodeID);
      assetStore.setActiveShot(item.NodeID);
    },
    [assetStore, closeEditingSession],
  );

  const editingNode = nodes.find((node) => node.id === editingNodeId)?.data.item;

  useEffect(() => {
    if (!editingNode) {
      if (editingNodeId) {
        editingItemRef.current = undefined;
        editingDraftRef.current = "";
        setEditingNodeId("");
      }
      return;
    }
    const previous = editingItemRef.current;
    if (previous && editingDraftRef.current === editableContent(previous)) {
      editingDraftRef.current = editableContent(editingNode);
    }
    editingItemRef.current = editingNode;
  }, [editingNode, editingNodeId]);

  const changeEditingDraft = useCallback((draft: string) => {
    editingDraftRef.current = draft;
  }, []);
  const getEditingDraft = useCallback(() => editingDraftRef.current, []);

  const generateFromEditor = useCallback(
    async (item: canvasnode.CanvasNode) => {
      if (isDeletedReferenceNode(item) || frameSwapRef.current) return;
      setEditorSaving(true);
      try {
        if (item.ActiveTaskRunID) return;
        const saved = await saveEditingNode();
        if (saved) await generateNode(saved);
      } finally {
        setEditorSaving(false);
      }
    },
    [generateNode, saveEditingNode],
  );

  const cancelGeneration = useCallback(
    async (item: canvasnode.CanvasNode) => {
      setEditorSaving(true);
      try {
        await cancelNodeGeneration(item);
      } finally {
        setEditorSaving(false);
      }
    },
    [cancelNodeGeneration],
  );

  const swapFrames = useCallback(
    (item: canvasnode.CanvasNode) => {
      if (frameSwapRef.current || editorSaving || item.ActiveTaskRunID) return;
      setEditorSaving(true);
      const pending = swapNodeFrames(item).finally(() => {
        frameSwapRef.current = undefined;
        setEditorSaving(false);
      });
      frameSwapRef.current = pending;
    },
    [editorSaving, swapNodeFrames],
  );

  const editingContextValue = useMemo<CanvasEditingContextValue>(
    () => ({
      projectId,
      cancel: (item) => void cancelGeneration(item),
      changeDraft: changeEditingDraft,
      close: () => void closeEditor(),
      collapseLargeTextEditor: () => setLargeTextEditorNodeId(""),
      collapseLargeTextPreview: () => setLargeTextPreviewNodeId(""),
      editingNodeId,
      generate: (item) => void generateFromEditor(item),
      getDraft: getEditingDraft,
      largeTextEditorNodeId,
      largeTextPreviewNodeId,
      openLargeTextPreview: (nodeId) => setLargeTextPreviewNodeId(nodeId),
      retry: (item) => void generateNode(item),
      save: saveWithoutClosing,
      saving: editorSaving,
      swapFrames,
    }),
    [
      projectId,
      cancelGeneration,
      changeEditingDraft,
      closeEditor,
      editingNodeId,
      editorSaving,
      generateFromEditor,
      generateNode,
      getEditingDraft,
      largeTextEditorNodeId,
      largeTextPreviewNodeId,
      swapFrames,
      saveWithoutClosing,
    ],
  );

  return {
    editingNode,
    editingContextValue,
    editingItemRef,
    closeEditor,
    openEditor,
    generateFromEditor,
    setEditingNodeId,
    setLargeTextEditorNodeId,
  };
}
