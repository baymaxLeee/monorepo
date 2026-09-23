import {
  Background,
  type Edge,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import { useAtomValue, useSetAtom } from "jotai";
import { Upload as IconUpload } from "lucide-react";
import {
  Fragment,
  type Ref,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";

import { AssetReviewDialog } from "@/components/AssetReviewDialog/index";
import { type AssetMentionItem, type AssetMentionSource } from "@/components/promptEditor/index";
import { Message, Spin } from "@/components/ui";
import { canvasnode } from "@/domain";
import { UpdateCanvasNode, CreateCanvasNode, CopyCanvasNode } from "@/pages/studio/domain/persistence";
import { resolveArtifactURL } from "@/utils/artifactURL";
import { latestAssetReview } from "@/utils/assetReview";
import t from "@/utils/i18n";

import { CANVAS_ASSET_DRAG_TYPE, type CanvasAssetDragData } from "../components/StudioAssetPanel";
import { canvasRequestErrorMessage } from "../domain/actions";
import type { CanvasStatePubSub } from "../domain/canvasStatePubSub";
import { assetFromCanvasNode, projectCanvasNodeAssets } from "../domain/model";
import { canvasAssetDetailsAtom, useStudioAssetStore } from "../store/assets";
import {
  assetsPanelOpenAtom,
  canvasGraphLoadedAtom,
  canvasNodesAtom,
  defaultImageModelIdAtom,
  defaultTextModelIdAtom,
  defaultVideoModelIdAtom,
  updateCanvasRevisionAtom,
  upsertCanvasNodesAtom,
  useStudioMutationCoordinator,
} from "../store/index";
import { CanvasAddToLibraryDialog } from "./assets/CanvasAddToLibraryDialog";
import { useCanvasAssetUpload } from "./assets/useCanvasAssetUpload";
import { useCanvasNodeAssets } from "./assets/useCanvasNodeAssets";
import {
  type CanvasContentActionsContextValue,
  CanvasContentActionsContext,
  CanvasEditingContext,
  CanvasQuickCreateContext,
  TextGenerationWaitingContext,
} from "./CanvasNodeContexts";

import "@xyflow/react/dist/style.css";

import { CanvasNodeIcon } from "./components/CanvasNodeIcon";
import { CanvasBoardControls } from "./controls/CanvasBoardControls";
import { canvasNodeDoubleClickAction } from "./controls/nodeDoubleClick";
import { selectNodesForDrag } from "./controls/nodeDragSelection";
import { useCanvasEditor } from "./editing/useCanvasEditor";
import { CanvasNodeHistoryDialog } from "./generation/CanvasNodeHistoryDialog";
import { useCanvasGeneration } from "./generation/useCanvasGeneration";
import { canvasEdgeTypes } from "./graph/CanvasEdge";
import {
  MATERIALIZED_NODE_HORIZONTAL_GAP,
  type AddMenu,
  type CanvasInteractionMode,
  canvasNodeClassName,
  contentAssetID,
  dtoToEdges,
  dtoToNode,
  isDeletedReferenceNode,
  isEditableNode,
  isEditableShortcutTarget,
  isGenerationType,
  matchesArrangeCanvasShortcut,
  nodePositionFromAnchor,
  nodePositionFromQuickConnection,
} from "./graph/canvasNodeHelpers";
import type { CanvasNodeStore } from "./graph/CanvasNodeStore";
import type { CanvasFlowNode, ContentPatch } from "./graph/canvasNodeTypes";
import { resolveCanvasConnection } from "./graph/connectionPolicy";
import { hasMeasuredCanvasNodes } from "./graph/layout";
import {
  type CanvasNodePortSide,
  canvasNodeInputWarning,
  canvasNodeProtocol,
  quickCreateNodeTypes,
  resolveCanvasNodeInput,
} from "./graph/nodeProtocol";
import { swapCanvasFrames } from "./graph/swapCanvasFrames";
import { useCanvasConnections } from "./graph/useCanvasConnections";
import { useCanvasLayout } from "./graph/useCanvasLayout";
import { nodeTypes } from "./nodes/CanvasCard";

import styles from "./CanvasBoard.module.less";

function CanvasBoardInner({
  assetsOpen,
  canvasId,
  controllerRef,
  defaultVideoModelId,
  defaultImageModelId,
  defaultTextModelId,
  onCanvasRevisionChange,
  onDeleteStoryboardDraft,
  onOpenStoryboardDraft,
  onRefreshGraph,
  nodePubSub,
  projectId,
  statePubSub,
}: {
  assetsOpen: boolean;
  canvasId: string;
  controllerRef: Ref<CanvasBoardHandle>;
  defaultVideoModelId: string;
  defaultImageModelId: string;
  defaultTextModelId: string;
  onCanvasRevisionChange: (revision: number) => void;
  onDeleteStoryboardDraft: (nodeId: string) => Promise<boolean>;
  onOpenStoryboardDraft: (nodeId: string) => void;
  onRefreshGraph: () => Promise<void>;
  nodePubSub: CanvasNodeStore;
  projectId: string;
  statePubSub: CanvasStatePubSub;
}) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const assetStore = useStudioAssetStore();
  const mutationCoordinator = useStudioMutationCoordinator();
  const graphNodes = useAtomValue(canvasNodesAtom);
  const graphLoaded = useAtomValue(canvasGraphLoadedAtom);
  const assetDetails = useAtomValue(canvasAssetDetailsAtom);
  const upsertCanvasNodes = useSetAtom(upsertCanvasNodesAtom);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [historyNode, setHistoryNode] = useState<canvasnode.CanvasNode>();
  const [reviewNode, setReviewNode] = useState<canvasnode.CanvasNode>();
  const [mentionReviewRequest, setMentionReviewRequest] = useState<{
    item: AssetMentionItem;
    onUpdated: Parameters<NonNullable<AssetMentionSource["review"]>>[1];
  }>();
  const [libraryNode, setLibraryNode] = useState<canvasnode.CanvasNode>();
  const [instance, setInstance] = useState<ReactFlowInstance<CanvasFlowNode, Edge>>();
  const [addMenu, setAddMenu] = useState<AddMenu>();
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>("select");
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const boardRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nodesRef = useRef<CanvasFlowNode[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const previousProjectionRef = useRef<
    | {
        nodesByID: Map<string, canvasnode.CanvasNode>;
        assetDetails: typeof assetDetails;
        callbacks: unknown[];
      }
    | undefined
  >(undefined);
  const nodeClickTimerRef = useRef<number | undefined>(undefined);
  const invalidConnectionWarningRef = useRef<string | undefined>(undefined);
  const resolveConnection = useCallback(
    (source: canvasnode.CanvasNode, target: canvasnode.CanvasNode) =>
      resolveCanvasConnection(source, target, edgesRef.current),
    [],
  );
  const resolveProspectiveConnection = useCallback(
    (
      sourceType: canvasnode.CanvasNodeType,
      target: Pick<canvasnode.CanvasNode, "IncomingEdges" | "Type" | "VideoInputMode">,
    ) =>
      resolveCanvasNodeInput(canvasNodeProtocol(sourceType).output.dataType, target, {
        kind: "connection",
      }),
    [],
  );

  useEffect(() => {
    const deletedNodeIDs = new Set(graphNodes.filter(isDeletedReferenceNode).map((item) => item.NodeID));
    if (deletedNodeIDs.size === 0) return;
    if (historyNode && deletedNodeIDs.has(historyNode.NodeID)) {
      setHistoryNode(undefined);
    }
    if (reviewNode && deletedNodeIDs.has(reviewNode.NodeID)) {
      setReviewNode(undefined);
    }
    if (libraryNode && deletedNodeIDs.has(libraryNode.NodeID)) {
      setLibraryNode(undefined);
    }
    if (mentionReviewRequest?.item.canvasNodeId && deletedNodeIDs.has(mentionReviewRequest.item.canvasNodeId)) {
      setMentionReviewRequest(undefined);
    }
  }, [graphNodes, historyNode, libraryNode, mentionReviewRequest, reviewNode]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  useEffect(() => {
    return () => {
      if (nodeClickTimerRef.current !== undefined) {
        window.clearTimeout(nodeClickTimerRef.current);
      }
    };
  }, []);

  const enqueueCanvasMutation = mutationCoordinator.enqueue;
  const { generateNode, cancelNodeGeneration, textGenerationWaitingNodeIDs } = useCanvasGeneration({
    canvasId,
    projectId,
    nodePubSub,
    statePubSub,
  });

  const patchNode = useCallback(
    (item: canvasnode.CanvasNode, patch: ContentPatch) => {
      if (isDeletedReferenceNode(item)) return Promise.resolve(item);
      const execute = async () => {
        const response = await UpdateCanvasNode(
          {
            ProjectID: projectId,
            CanvasID: canvasId,
            NodeID: item.NodeID,
            ...patch,
          },
          { skipErrorNotify: true },
        );
        upsertCanvasNodes([response.CanvasNode]);
        setNodes((current) =>
          current.map((node) =>
            node.id === item.NodeID
              ? {
                  ...node,
                  data: { ...node.data, item: response.CanvasNode },
                }
              : node,
          ),
        );
        return response.CanvasNode;
      };
      return enqueueCanvasMutation(execute).catch((error) => {
        Message.error(canvasRequestErrorMessage(error, t("节点保存失败，请刷新后重试")));
        throw error;
      });
    },
    [canvasId, enqueueCanvasMutation, nodePubSub.store, projectId, setNodes, upsertCanvasNodes],
  );

  const swapNodeFrames = useCallback(
    async (item: canvasnode.CanvasNode) => {
      try {
        await enqueueCanvasMutation(async () => {
          const current = nodePubSub.store.get(canvasNodesAtom).find((node) => node.NodeID === item.NodeID);
          if (!current) return;
          await swapCanvasFrames({
            projectId,
            canvasId,
            item: current,
            onUpdate: (response) => {
              upsertCanvasNodes([response.TargetNode]);
              onCanvasRevisionChange(response.CanvasRevision);
            },
          });
        });
      } catch (error) {
        Message.error(canvasRequestErrorMessage(error, t("首尾帧交换失败，请刷新后重试")));
        // 刷新必须在写队列外，避免 refresh 等待当前 mutation 造成死锁。
        try {
          await onRefreshGraph();
        } catch {
          Message.error(t("画布刷新失败，请刷新页面后重试"));
        }
      }
    },
    [
      canvasId,
      enqueueCanvasMutation,
      nodePubSub.store,
      onCanvasRevisionChange,
      onRefreshGraph,
      projectId,
      upsertCanvasNodes,
    ],
  );

  const {
    editingNode,
    editingContextValue,
    editingItemRef,
    closeEditor,
    openEditor,
    generateFromEditor,
    setEditingNodeId,
    setLargeTextEditorNodeId,
  } = useCanvasEditor({
    projectId,
    graphNodes,
    patchNode,
    generateNode,
    cancelNodeGeneration,
    swapNodeFrames,
  });

  const openHistory = useCallback((item: canvasnode.CanvasNode) => {
    if (
      isDeletedReferenceNode(item) ||
      (item.Type !== canvasnode.CanvasNodeType.IMAGE_GENERATION &&
        item.Type !== canvasnode.CanvasNodeType.VIDEO_GENERATION &&
        item.Type !== canvasnode.CanvasNodeType.TEXT_GENERATION)
    ) {
      return;
    }
    setHistoryNode(item);
  }, []);

  const activateInteractionMode = useCallback(
    (mode: CanvasInteractionMode) => {
      setInteractionMode(mode);
      setModeMenuOpen(false);
      setAddMenu(undefined);
      if (mode === "hand") {
        setShortcutsOpen(false);
        setNodes((current) => current.map((node) => (node.selected ? { ...node, selected: false } : node)));
        setEdges((current) => current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
        if (editingItemRef.current) void closeEditor();
      }
    },
    [closeEditor, setEdges, setNodes],
  );

  const { queryNodeAssets, selectNodeAssetWithFeedback } = useCanvasNodeAssets({
    canvasId,
    projectId,
    nodesRef,
    resolveConnection,
    onCanvasRevisionChange,
  });

  useEffect(() => {
    if (!graphLoaded) return;
    const graphNodesByID = new Map(graphNodes.map((item) => [item.NodeID, item]));
    const callbacks = [nodePubSub, openHistory, patchNode, queryNodeAssets, selectNodeAssetWithFeedback];
    const previousProjection = previousProjectionRef.current;
    const callbacksUnchanged = callbacks.every((callback, index) => callback === previousProjection?.callbacks[index]);
    const currentByID = new Map(nodesRef.current.map((node) => [node.id, node]));
    const nextNodes = graphNodes.map((item) => {
      const current = currentByID.get(item.NodeID);
      if (
        current?.data.item === item &&
        previousProjection !== undefined &&
        callbacksUnchanged &&
        previousProjection.assetDetails.get(item.NodeID) === assetDetails.get(item.NodeID) &&
        item.IncomingEdges.every(
          (edge) =>
            previousProjection.nodesByID.get(edge.SourceNodeID) === graphNodesByID.get(edge.SourceNodeID) &&
            previousProjection.assetDetails.get(edge.SourceNodeID) === assetDetails.get(edge.SourceNodeID),
        )
      ) {
        return current;
      }
      const detail = assetFromCanvasNode(item, assetDetails.get(item.NodeID));
      const referenceAssets = projectCanvasNodeAssets(graphNodes, item.NodeID, assetDetails, graphNodesByID);
      if (current) {
        return {
          ...current,
          className: canvasNodeClassName(item),
          data: {
            ...current.data,
            item,
            previewURL: detail.previewUrl,
            referenceAssets,
            reviewAsset: detail,
            thumbnailURL:
              item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION ? item.FirstFrameURL : detail.thumbnail,
          },
        };
      }
      return dtoToNode(
        item,
        nodePubSub,
        openHistory,
        (itemToPatch, patch) => patchNode(itemToPatch, patch),
        (...args) => queryNodeAssets(item.NodeID, ...args),
        (candidate) => selectNodeAssetWithFeedback(item, candidate),
        detail.previewUrl,
        item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION ? item.FirstFrameURL : detail.thumbnail,
        referenceAssets,
        detail,
      );
    });
    setNodes((current) =>
      current.length === nextNodes.length && current.every((node, index) => node === nextNodes[index])
        ? current
        : nextNodes,
    );
    setEdges((current) => {
      const next = dtoToEdges(graphNodes);
      return current.length === next.length &&
        current.every(
          (edge, index) =>
            edge.id === next[index].id &&
            edge.source === next[index].source &&
            edge.target === next[index].target &&
            edge.sourceHandle === next[index].sourceHandle &&
            edge.targetHandle === next[index].targetHandle,
        )
        ? current
        : next;
    });
    previousProjectionRef.current = { nodesByID: graphNodesByID, assetDetails, callbacks };
  }, [
    assetDetails,
    graphLoaded,
    graphNodes,
    nodePubSub,
    openHistory,
    patchNode,
    queryNodeAssets,
    selectNodeAssetWithFeedback,
    setEdges,
    setNodes,
  ]);

  const { arrangeNodes, persistPosition } = useCanvasLayout({
    canvasId,
    projectId,
    nodes,
    edges,
    nodesRef,
    edgesRef,
    setNodes,
    instance,
    graphLoaded,
    onRefreshGraph,
  });

  const byID = useMemo(() => new Map(graphNodes.map((node) => [node.NodeID, node])), [graphNodes]);

  const { connect, persistConnection, deleteSelectedElements } = useCanvasConnections({
    canvasId,
    projectId,
    byID,
    nodesRef,
    edgesRef,
    setNodes,
    setEdges,
    resolveConnection,
    onDeleteStoryboardDraft,
    onCanvasRevisionChange,
  });

  const createNode = useCallback(
    async (
      type: canvasnode.CanvasNodeType,
      options?: {
        assetId?: string;
        resourceId?: string;
        resourceAssetId?: string;
        position?: { x: number; y: number };
        uploadedAsset?: canvasnode.CanvasUploadedAsset;
      },
    ) => {
      const quickConnection = addMenu?.quickConnection;
      const quickAnchor = quickConnection
        ? nodesRef.current.find((node) => node.id === quickConnection.anchorNodeID)
        : undefined;
      const point = options?.position
        ? {
            flowX: options.position.x,
            flowY: options.position.y,
          }
        : quickConnection && quickAnchor
          ? nodePositionFromQuickConnection(type, quickAnchor, quickConnection.side)
          : addMenu
            ? nodePositionFromAnchor(type, addMenu)
            : { flowX: 120, flowY: 120 };
      if (type === canvasnode.CanvasNodeType.VIDEO_GENERATION && !defaultVideoModelId) {
        Message.error(t("暂无可用视频模型"));
        return;
      }
      if (type === canvasnode.CanvasNodeType.IMAGE_GENERATION && !defaultImageModelId) {
        Message.error(t("暂无可用图片模型"));
        return;
      }
      if (type === canvasnode.CanvasNodeType.TEXT_GENERATION && !defaultTextModelId) {
        Message.error(t("暂无可用文本模型"));
        return;
      }
      try {
        const response = await enqueueCanvasMutation(async () => {
          const created = await CreateCanvasNode(
            {
              ProjectID: projectId,
              CanvasID: canvasId,
              Type: type,
              AssetID: options?.assetId,
              ResourceID: options?.resourceId,
              ResourceAssetID: options?.resourceAssetId,
              UploadedAsset: options?.uploadedAsset,
              ModelServiceID:
                type === canvasnode.CanvasNodeType.VIDEO_GENERATION
                  ? defaultVideoModelId
                  : type === canvasnode.CanvasNodeType.IMAGE_GENERATION
                    ? defaultImageModelId
                    : type === canvasnode.CanvasNodeType.TEXT_GENERATION
                      ? defaultTextModelId
                      : undefined,
              Text: type === canvasnode.CanvasNodeType.TEXT ? "" : undefined,
              Position: {
                PositionX: point.flowX,
                PositionY: point.flowY,
              },
            },
            { skipErrorNotify: true },
          );
          onCanvasRevisionChange(created.CanvasRevision);
          upsertCanvasNodes([created.CanvasNode]);
          return created;
        });
        setNodes((current) => [
          ...current,
          dtoToNode(
            response.CanvasNode,
            nodePubSub,
            openHistory,
            (itemToPatch, patch) => patchNode(itemToPatch, patch),
            (...args) => queryNodeAssets(response.CanvasNode.NodeID, ...args),
            (candidate) => selectNodeAssetWithFeedback(response.CanvasNode, candidate),
          ),
        ]);
        if (quickConnection && quickAnchor) {
          await persistConnection(
            quickConnection.side === "output" ? quickAnchor.data.item : response.CanvasNode,
            quickConnection.side === "output" ? response.CanvasNode : quickAnchor.data.item,
          );
        }
        if (isEditableNode(response.CanvasNode.Type)) {
          setNodes((current) =>
            current.map((node) => ({
              ...node,
              selected: node.id === response.CanvasNode.NodeID,
            })),
          );
          setEdges((current) => current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
          await openEditor(response.CanvasNode);
        }
        return response.CanvasNode;
      } catch {
        Message.error(t("节点创建失败，请重试"));
        return undefined;
      } finally {
        setAddMenu(undefined);
      }
    },
    [
      addMenu,
      assetStore,
      canvasId,
      defaultVideoModelId,
      defaultImageModelId,
      defaultTextModelId,
      enqueueCanvasMutation,
      nodePubSub.store,
      nodePubSub,
      onCanvasRevisionChange,
      openEditor,
      openHistory,
      persistConnection,
      projectId,
      setEdges,
      setNodes,
      upsertCanvasNodes,
    ],
  );

  const openAddMenu = useCallback(
    (event: React.MouseEvent) => {
      if (!instance) return;
      setShortcutsOpen(false);
      const position = instance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const bounds = boardRef.current?.getBoundingClientRect();
      if (!bounds) return;
      setAddMenu({
        clientX: Math.max(12, Math.min(event.clientX - bounds.left, bounds.width - 160)),
        clientY: Math.max(12, Math.min(event.clientY - bounds.top, bounds.height - 230)),
        flowX: position.x,
        flowY: position.y,
      });
    },
    [instance],
  );

  const openQuickCreateMenu = useCallback(
    (item: canvasnode.CanvasNode, side: CanvasNodePortSide, event: React.MouseEvent) => {
      if (!instance || isDeletedReferenceNode(item)) return;
      const bounds = boardRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const types = quickCreateNodeTypes(item, side).filter((type) => {
        if (side === "output") return true;
        return resolveProspectiveConnection(type, item).accepted;
      });
      if (types.length === 0) return;
      const position = instance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const menuHeight = types.length * 34 + 12;
      setShortcutsOpen(false);
      setModeMenuOpen(false);
      setAddMenu({
        clientX: Math.max(
          12,
          Math.min(event.clientX - bounds.left + (side === "output" ? 20 : -152), bounds.width - 144),
        ),
        clientY: Math.max(12, Math.min(event.clientY - bounds.top - 18, bounds.height - menuHeight - 12)),
        flowX: position.x,
        flowY: position.y,
        quickConnection: { anchorNodeID: item.NodeID, side },
        types,
      });
    },
    [instance, resolveProspectiveConnection],
  );

  const quickCreateContextValue = useMemo(() => ({ open: openQuickCreateMenu }), [openQuickCreateMenu]);

  const openToolbarAddMenu = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!instance) return;
      setShortcutsOpen(false);
      if (addMenu) {
        setAddMenu(undefined);
        return;
      }
      const bounds = boardRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const screen = {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      };
      const position = instance.screenToFlowPosition(screen);
      setAddMenu({
        clientX: Math.max(12, bounds.width / 2 - 74),
        clientY: Math.max(12, bounds.height - 260),
        flowX: position.x,
        flowY: position.y,
      });
    },
    [addMenu, instance],
  );

  const uploadFiles = useCanvasAssetUpload({ createNode });

  const locateNode = useCallback(
    (nodeId: string) => {
      const target = nodesRef.current.find((node) => node.id === nodeId);
      if (!target || !instance) return;
      setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })));
      void instance.fitView({
        nodes: [target],
        duration: 320,
        maxZoom: 1.2,
        padding: 0.5,
      });
    },
    [instance, setNodes],
  );

  const pauseMedia = useCallback(() => {
    workspaceRef.current?.querySelectorAll<HTMLMediaElement>("video, audio").forEach((media) => media.pause());
  }, []);

  useImperativeHandle(controllerRef, () => ({ finishEditing: closeEditor, locateNode, pauseMedia }), [
    closeEditor,
    locateNode,
    pauseMedia,
  ]);

  const copyNode = useCallback(
    async (item: canvasnode.CanvasNode) => {
      if (isDeletedReferenceNode(item)) return;
      const sourceNode = instance?.getNode(item.NodeID);
      const sourceWidth = sourceNode?.measured?.width;
      if (!sourceNode || sourceWidth === undefined) {
        Message.error(t("节点尚未完成布局，请稍后重试"));
        return;
      }
      try {
        const response = await enqueueCanvasMutation(async () => {
          const copied = await CopyCanvasNode(
            {
              ProjectID: projectId,
              CanvasID: canvasId,
              SourceNodeID: item.NodeID,
              Position: {
                PositionX: sourceNode.position.x + sourceWidth + MATERIALIZED_NODE_HORIZONTAL_GAP,
                PositionY: sourceNode.position.y,
              },
            },
            { skipErrorNotify: true },
          );
          onCanvasRevisionChange(copied.CanvasRevision);
          upsertCanvasNodes([copied.CanvasNode]);
          return copied;
        });
        const copiedDetail = assetFromCanvasNode(response.CanvasNode);
        assetStore.cacheDetails([copiedDetail]);
        const copiedNode = dtoToNode(
          response.CanvasNode,
          nodePubSub,
          openHistory,
          (itemToPatch, patch) => patchNode(itemToPatch, patch),
          (...args) => queryNodeAssets(response.CanvasNode.NodeID, ...args),
          (candidate) => selectNodeAssetWithFeedback(response.CanvasNode, candidate),
        );
        setNodes((current) => [
          ...current.map((node) => ({ ...node, selected: false })),
          { ...copiedNode, selected: true },
        ]);
        Message.success(t("已复制节点"));
      } catch {
        Message.error(t("节点复制失败，请重试"));
      }
    },
    [
      assetStore,
      canvasId,
      enqueueCanvasMutation,
      instance,
      nodePubSub.store,
      nodePubSub,
      onCanvasRevisionChange,
      openHistory,
      patchNode,
      projectId,
      queryNodeAssets,
      selectNodeAssetWithFeedback,
      setNodes,
      upsertCanvasNodes,
    ],
  );

  const contentActionsContextValue = useMemo<CanvasContentActionsContextValue>(
    () => ({
      addToLibrary: (item) => {
        if (!isDeletedReferenceNode(item)) setLibraryNode(item);
      },
      copy: (item) => void copyNode(item),
      review: (item) => {
        if (!isDeletedReferenceNode(item)) setReviewNode(item);
      },
      reviewAsset: (item, onUpdated) => setMentionReviewRequest({ item, onUpdated }),
    }),
    [copyNode],
  );

  useEffect(() => {
    if (!editingNode) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        const nodeId = editingNode.NodeID;
        void closeEditor().then((closed) => {
          if (!closed) return;
          window.requestAnimationFrame(() => {
            boardRef.current
              ?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(nodeId)}"]`)
              ?.focus({ preventScroll: true });
          });
        });
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (isGenerationType(editingNode.Type)) {
          const latest = nodePubSub.store.get(canvasNodesAtom).find((node) => node.NodeID === editingNode.NodeID);
          void generateFromEditor(latest ?? editingNode);
        } else {
          void closeEditor();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeEditor, editingNode, generateFromEditor, nodePubSub]);

  useEffect(() => {
    const handleCanvasShortcut = (event: KeyboardEvent) => {
      if (isEditableShortcutTarget(event.target)) return;
      if (event.key === "Escape" && (modeMenuOpen || shortcutsOpen)) {
        event.preventDefault();
        setModeMenuOpen(false);
        setShortcutsOpen(false);
        return;
      }
      if (!event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.key.toLowerCase() === "v") {
          event.preventDefault();
          activateInteractionMode("select");
          return;
        }
        if (event.key.toLowerCase() === "h") {
          event.preventDefault();
          activateInteractionMode("hand");
          return;
        }
      }
      if (matchesArrangeCanvasShortcut(event) && hasMeasuredCanvasNodes(nodesRef.current)) {
        event.preventDefault();
        void arrangeNodes().then((success) => {
          if (success) Message.success(t("画布布局已整理"));
        });
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || !instance) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        void instance.zoomIn({ duration: 160 });
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        void instance.zoomOut({ duration: 160 });
        return;
      }
      if (event.key === "0") {
        event.preventDefault();
        void instance.fitView({ duration: 240 });
      }
    };
    window.addEventListener("keydown", handleCanvasShortcut);
    return () => window.removeEventListener("keydown", handleCanvasShortcut);
  }, [activateInteractionMode, arrangeNodes, instance, modeMenuOpen, shortcutsOpen]);

  return (
    <div className={styles.workspace} ref={workspaceRef}>
      <section
        className={`${styles.board} ${interactionMode === "hand" ? styles.boardHandMode : ""}`}
        onClick={() => {
          setAddMenu(undefined);
          setModeMenuOpen(false);
        }}
        onDoubleClick={(event) => {
          if (interactionMode === "hand") return;
          const target = event.target as HTMLElement;
          if (
            target.closest(".react-flow__pane") &&
            !target.closest(".react-flow__node") &&
            !target.closest("button")
          ) {
            event.preventDefault();
            event.stopPropagation();
            openAddMenu(event);
          }
        }}
        onDragOver={(event) => {
          if (interactionMode === "hand") return;
          if (event.dataTransfer.types.includes(CANVAS_ASSET_DRAG_TYPE)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          if (interactionMode === "hand") return;
          const raw = event.dataTransfer.getData(CANVAS_ASSET_DRAG_TYPE);
          if (!raw || !instance) return;
          event.preventDefault();
          try {
            const data = JSON.parse(raw) as CanvasAssetDragData;
            const position = instance.screenToFlowPosition({
              x: event.clientX,
              y: event.clientY,
            });
            void createNode(data.nodeType, {
              resourceId: data.resourceId,
              resourceAssetId: data.resourceAssetId,
              position,
            });
          } catch {
            Message.error(t("无法读取拖入的素材"));
          }
        }}
        ref={boardRef}
      >
        <CanvasContentActionsContext.Provider value={contentActionsContextValue}>
          <TextGenerationWaitingContext.Provider value={textGenerationWaitingNodeIDs}>
            <CanvasEditingContext.Provider value={editingContextValue}>
              <CanvasQuickCreateContext.Provider value={quickCreateContextValue}>
                <ReactFlow<CanvasFlowNode, Edge>
                  edgeTypes={canvasEdgeTypes}
                  deleteKeyCode={["Backspace", "Delete"]}
                  edges={edges}
                  edgesFocusable={false}
                  elementsSelectable={interactionMode === "select"}
                  maxZoom={4}
                  minZoom={0.15}
                  multiSelectionKeyCode={["Meta", "Control"]}
                  nodeTypes={nodeTypes}
                  nodes={nodes}
                  nodesConnectable={interactionMode === "select"}
                  nodesDraggable={interactionMode === "select"}
                  nodesFocusable={false}
                  isValidConnection={(connection) => {
                    invalidConnectionWarningRef.current = undefined;
                    const source = byID.get(connection.source);
                    const target = byID.get(connection.target);
                    if (!source || !target) return false;
                    const resolution = resolveConnection(source, target);
                    invalidConnectionWarningRef.current = resolution.accepted
                      ? undefined
                      : canvasNodeInputWarning(resolution);
                    return resolution.accepted;
                  }}
                  onConnect={(connection) => void connect(connection)}
                  onConnectEnd={(_event, connectionState) => {
                    if (
                      connectionState.isValid === false &&
                      connectionState.toNode &&
                      invalidConnectionWarningRef.current
                    ) {
                      Message.warning(invalidConnectionWarningRef.current);
                    }
                    invalidConnectionWarningRef.current = undefined;
                  }}
                  onBeforeDelete={deleteSelectedElements}
                  onEdgesChange={onEdgesChange}
                  onEdgeClick={(event) => {
                    window.clearTimeout(nodeClickTimerRef.current);
                    if (interactionMode === "hand") return;
                    if (event.metaKey || event.ctrlKey) return;
                    void closeEditor();
                  }}
                  onInit={setInstance}
                  onNodeClick={(event, node) => {
                    window.clearTimeout(nodeClickTimerRef.current);
                    if (interactionMode === "hand") return;
                    if (event.metaKey || event.ctrlKey) return;
                    setNodes((current) =>
                      current.map((item) => ({
                        ...item,
                        selected: item.id === node.id,
                      })),
                    );
                    setEdges((current) => current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)));
                    if (isDeletedReferenceNode(node.data.item)) return;
                    if (node.data.item.Type === canvasnode.CanvasNodeType.STORYBOARD_DRAFT) {
                      onOpenStoryboardDraft(node.id);
                      return;
                    }
                    nodeClickTimerRef.current = window.setTimeout(() => {
                      nodeClickTimerRef.current = undefined;
                      void openEditor(node.data.item);
                    }, 220);
                  }}
                  onNodeDragStart={(_event, node) => {
                    window.clearTimeout(nodeClickTimerRef.current);
                    if (!nodesRef.current.find((item) => item.id === node.id)?.selected) {
                      setEdges((current) =>
                        current.map((edge) => (edge.selected ? { ...edge, selected: false } : edge)),
                      );
                    }
                    setNodes((current) => selectNodesForDrag(current, node.id));
                  }}
                  onNodeDragStop={(event, node, draggedNodes) => {
                    void openEditor(node.data.item);
                    void persistPosition(event, node, draggedNodes);
                  }}
                  onNodeDoubleClick={(event, node) => {
                    window.clearTimeout(nodeClickTimerRef.current);
                    if (interactionMode === "hand") return;
                    if (event.metaKey || event.ctrlKey) return;
                    if (isDeletedReferenceNode(node.data.item)) return;
                    event.stopPropagation();
                    const action = canvasNodeDoubleClickAction(node.data.item);
                    if (action === "none") return;
                    if (action === "large-text-editor") {
                      void openEditor(node.data.item).then(() => {
                        if (editingItemRef.current?.NodeID === node.id) {
                          setLargeTextEditorNodeId(node.id);
                        }
                      });
                      return;
                    }
                    if (action === "large-text-preview") {
                      editingContextValue.openLargeTextPreview(node.id);
                      return;
                    }
                    if (editingItemRef.current?.NodeID === node.id) {
                      setEditingNodeId("");
                      void closeEditor();
                    }
                    const preview = document.querySelector<HTMLElement>(
                      `[data-canvas-node-preview="${CSS.escape(node.id)}"]`,
                    );
                    if (preview?.requestFullscreen) {
                      void preview.requestFullscreen().catch(() => Message.error(t("无法进入全屏")));
                    }
                  }}
                  onNodesChange={onNodesChange}
                  onPaneClick={() => {
                    window.clearTimeout(nodeClickTimerRef.current);
                    setAddMenu(undefined);
                    setModeMenuOpen(false);
                    setShortcutsOpen(false);
                    if (editingContextValue.editingNodeId) void closeEditor();
                  }}
                  panOnDrag={interactionMode === "hand"}
                  panOnScroll
                  selectNodesOnDrag={false}
                  selectionOnDrag={interactionMode === "select"}
                  zoomOnDoubleClick={false}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background />
                </ReactFlow>
              </CanvasQuickCreateContext.Provider>
            </CanvasEditingContext.Provider>
          </TextGenerationWaitingContext.Provider>
        </CanvasContentActionsContext.Provider>

        <CanvasBoardControls
          assetsOpen={assetsOpen}
          graphLoaded={graphLoaded}
          nodeCount={nodes.length}
          canArrange={nodes.length > 0 && hasMeasuredCanvasNodes(nodes)}
          instance={instance}
          interactionMode={interactionMode}
          modeMenuOpen={modeMenuOpen}
          shortcutsOpen={shortcutsOpen}
          setModeMenuOpen={setModeMenuOpen}
          setShortcutsOpen={setShortcutsOpen}
          onDismissAddMenu={() => setAddMenu(undefined)}
          arrangeNodes={arrangeNodes}
          activateInteractionMode={activateInteractionMode}
          openToolbarAddMenu={openToolbarAddMenu}
        />

        {addMenu ? (
          <div
            className={styles.addMenu}
            onClick={(event) => event.stopPropagation()}
            style={{ left: addMenu.clientX, top: addMenu.clientY }}
          >
            {(
              addMenu.types ?? [
                canvasnode.CanvasNodeType.TEXT_GENERATION,
                canvasnode.CanvasNodeType.IMAGE_GENERATION,
                canvasnode.CanvasNodeType.VIDEO_GENERATION,
              ]
            ).map((type) => {
              const protocol = canvasNodeProtocol(type);
              return (
                <Fragment key={type}>
                  {type === canvasnode.CanvasNodeType.TEXT ? <div className={styles.menuDivider} /> : null}
                  <button className={styles.addItem} onClick={() => void createNode(type)} type="button">
                    <CanvasNodeIcon aria-hidden nodeType={type} size={16} strokeWidth={1.5} />
                    {t(protocol.createLabel)}
                  </button>
                </Fragment>
              );
            })}
            {!addMenu.types ? (
              <>
                <button className={styles.addItem} onClick={() => fileInputRef.current?.click()} type="button">
                  <IconUpload aria-hidden size={16} strokeWidth={1.5} />
                  {t("上传")}
                </button>
                <div className={styles.menuDivider} />
                <button
                  className={styles.addItem}
                  onClick={() => void createNode(canvasnode.CanvasNodeType.TEXT)}
                  type="button"
                >
                  <CanvasNodeIcon aria-hidden nodeType={canvasnode.CanvasNodeType.TEXT} size={16} strokeWidth={1.5} />
                  {t(canvasNodeProtocol(canvasnode.CanvasNodeType.TEXT).createLabel)}
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <input
          accept="image/*,video/mp4,video/quicktime,audio/*"
          className={styles.fileInput}
          multiple
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            const position = addMenu ? { x: addMenu.flowX, y: addMenu.flowY } : undefined;
            event.target.value = "";
            void uploadFiles(files, position);
            setAddMenu(undefined);
          }}
          ref={fileInputRef}
          type="file"
        />

        {!graphLoaded ? (
          <div className={styles.loading}>
            <Spin size={28} />
          </div>
        ) : null}

        <CanvasNodeHistoryDialog
          canvasId={canvasId}
          projectId={projectId}
          item={historyNode}
          onClose={() => setHistoryNode(undefined)}
          shotIndex={Math.max(
            0,
            nodes.findIndex((node) => node.id === historyNode?.NodeID),
          )}
        />
        <AssetReviewDialog
          items={reviewNode ? [{ assetId: contentAssetID(reviewNode) }] : []}
          materialName={t("素材")}
          onClose={() => setReviewNode(undefined)}
          onPartialSuccess={(results) => {
            results.forEach((result) => assetStore.updateReview(result.AssetID, result.Review));
          }}
          onSuccess={(results) => {
            results.forEach((result) => assetStore.updateReview(result.AssetID, result.Review));
            setReviewNode(undefined);
          }}
          projectId={projectId}
          visible={Boolean(reviewNode)}
        />
        <AssetReviewDialog
          items={
            mentionReviewRequest
              ? [
                  {
                    assetId: mentionReviewRequest.item.assetId ?? mentionReviewRequest.item.id,
                    review: mentionReviewRequest.item.review,
                  },
                ]
              : []
          }
          materialName={mentionReviewRequest?.item.category === "audio" ? t("音频素材") : t("形象素材")}
          onClose={() => setMentionReviewRequest(undefined)}
          onPartialSuccess={(results) => {
            results.forEach((result) => assetStore.updateReview(result.AssetID, result.Review));
            const latest = results.at(-1);
            if (latest) mentionReviewRequest?.onUpdated(latest.Review);
          }}
          onSuccess={(results) => {
            results.forEach((result) => assetStore.updateReview(result.AssetID, result.Review));
            const latest = results.at(-1);
            if (latest) mentionReviewRequest?.onUpdated(latest.Review);
            setMentionReviewRequest(undefined);
          }}
          projectId={projectId}
          visible={Boolean(mentionReviewRequest)}
        />
        <CanvasAddToLibraryDialog
          canvasId={canvasId}
          item={libraryNode}
          onClose={() => setLibraryNode(undefined)}
          onSuccess={(response) => {
            if (!libraryNode || !response.CanvasNodeBinding) return;
            const binding = response.CanvasNodeBinding;
            const updated: canvasnode.CanvasNode = {
              ...libraryNode,
              AssetID: undefined,
              CurrentAssetID: binding.CurrentAssetID,
              ResourceAssetID: binding.ResourceAssetID,
              ResourceAssetIsPrimary: response.ResourceAsset.IsPrimary,
              ResourceAssetRevision: response.ResourceAsset.Revision,
              Revision: binding.CanvasNodeRevision,
              SelectedAssetID: undefined,
              SelectedOutputID: undefined,
            };
            upsertCanvasNodes([updated]);
            assetStore.cacheDetails([
              {
                ...assetFromCanvasNode(updated),
                assetId: binding.CurrentAssetID,
                previewUrl: resolveArtifactURL(response.ResourceAsset.PreviewURL ?? ""),
                resourceAssetId: binding.ResourceAssetID,
                resourceId: response.Resource.ResourceID,
                review: latestAssetReview(response.ResourceAsset.Reviews),
                reviews: response.ResourceAsset.Reviews,
              },
            ]);
          }}
          projectId={projectId}
        />
      </section>
    </div>
  );
}

export interface CanvasBoardHandle {
  finishEditing: () => Promise<boolean>;
  locateNode: (nodeId: string) => void;
  pauseMedia: () => void;
}

export const CanvasBoard = forwardRef<
  CanvasBoardHandle,
  {
    nodePubSub: CanvasNodeStore;
    onDeleteStoryboardDraft: (nodeId: string) => Promise<boolean>;
    onOpenStoryboardDraft: (nodeId: string) => void;
    onRefreshGraph: () => Promise<void>;
    statePubSub: CanvasStatePubSub;
  }
>(function CanvasBoard(
  { nodePubSub, onDeleteStoryboardDraft, onOpenStoryboardDraft, onRefreshGraph, statePubSub },
  ref,
) {
  const { projectId = "", canvasId = "" } = useParams();
  const assetsOpen = useAtomValue(assetsPanelOpenAtom);
  const defaultVideoModelId = useAtomValue(defaultVideoModelIdAtom);
  const defaultImageModelId = useAtomValue(defaultImageModelIdAtom);
  const defaultTextModelId = useAtomValue(defaultTextModelIdAtom);
  const onCanvasRevisionChange = useSetAtom(updateCanvasRevisionAtom);

  return (
    <ReactFlowProvider>
      <CanvasBoardInner
        assetsOpen={assetsOpen}
        canvasId={canvasId}
        controllerRef={ref}
        defaultImageModelId={defaultImageModelId}
        defaultTextModelId={defaultTextModelId}
        defaultVideoModelId={defaultVideoModelId}
        nodePubSub={nodePubSub}
        onCanvasRevisionChange={onCanvasRevisionChange}
        onDeleteStoryboardDraft={onDeleteStoryboardDraft}
        onOpenStoryboardDraft={onOpenStoryboardDraft}
        onRefreshGraph={onRefreshGraph}
        projectId={projectId}
        statePubSub={statePubSub}
      />
    </ReactFlowProvider>
  );
});
