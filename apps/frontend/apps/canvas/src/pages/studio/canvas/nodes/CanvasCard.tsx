import { type NodeProps, type NodeTypes } from "@xyflow/react";
import { useAtomValue } from "jotai";
import { CircleAlert as IconExclamationCircleRedFill, LoaderCircle, Music as IconMusic } from "lucide-react";
import { memo, useContext } from "react";

import { AudioPlayer } from "@/components/audioPlayer/index";
import { Markdown } from "@/components/common";
import { GenerationConfiguration } from "@/components/GenerationConfiguration/index";
import { canvasnode } from "@/domain";
import { resolveArtifactURL } from "@/utils/artifactURL";
import t from "@/utils/i18n";

import { useMaterialMatching } from "../../assetMatching/useMaterialMatching";
import { generationConfigPatch, settingsFromDTO } from "../../domain/actions";
import { isVideoGenerationCancellationDisabled } from "../../domain/generationCancellation";
import { defaultImageModelIdAtom } from "../../store/index";
import { CanvasContentActionsContext, CanvasEditingContext, TextGenerationWaitingContext } from "../CanvasNodeContexts";
import { CanvasNodeIcon } from "../components/CanvasNodeIcon";
import { CanvasModelSelect, useCanvasModelOptions } from "../editing/CanvasModelSelect";
import { CanvasPromptEditor } from "../editing/CanvasPromptEditor";
import { CanvasTextEditor } from "../editing/CanvasTextEditor";
import { CanvasGeneratingBadge } from "../generation/CanvasGeneratingBadge";
import { CanvasGenerationFailureState } from "../generation/CanvasGenerationFailureState";
import { generationPreviewMode, shouldShowGenerationLoadingBackground } from "../generation/generationLoading";
import { isDeletedReferenceNode, isGenerationType, textNodeContent } from "../graph/canvasNodeHelpers";
import { useCanvasNodeSnapshot } from "../graph/CanvasNodeStore";
import type { CanvasFlowNode } from "../graph/canvasNodeTypes";
import { canvasNodeProtocol } from "../graph/nodeProtocol";
import { CanvasNodeHeader } from "./CanvasNodeHeader";
import { CanvasNodePort } from "./CanvasNodePort";
import { CanvasNodeVideoPlayer } from "./CanvasNodeVideoPlayer";
import { CanvasTextGenerationPreview } from "./CanvasTextGenerationPreview";
import { CanvasTextResultOperations } from "./CanvasTextResultOperations";
import { CanvasNodeToolbar } from "./Toolbar";
import {
  MEDIA_ASSET_DEFAULT_PREVIEW_SIZE,
  MEDIA_GENERATION_DEFAULT_PREVIEW_SIZE,
  useMediaNodePreviewSize,
} from "./useMediaNodePreviewSize";

import styles from "../CanvasBoard.module.less";
export function DeletedReferenceNotice({ item }: { item: canvasnode.CanvasNode }) {
  if (item.ReferenceStatus !== canvasnode.CanvasNodeReferenceStatus.DELETED) {
    return null;
  }
  return (
    <div className={styles.deletedReferenceNotice}>
      <IconExclamationCircleRedFill aria-hidden />
      <strong>{t("引用素材已删除")}</strong>
    </div>
  );
}

// XYFlow moves the outer wrapper itself; position-only NodeProps changes must not rerender the heavy card subtree.
function canvasCardPropsEqual(previous: NodeProps<CanvasFlowNode>, next: NodeProps<CanvasFlowNode>) {
  return previous.data === next.data && previous.dragging === next.dragging && previous.selected === next.selected;
}

export const CanvasCard = memo(function CanvasCard({ data, dragging, selected }: NodeProps<CanvasFlowNode>) {
  const editor = useContext(CanvasEditingContext);
  const actions = useContext(CanvasContentActionsContext);
  const textGenerationWaitingNodeIDs = useContext(TextGenerationWaitingContext);
  const { image: imageModelOptions, selected: modelOptions } = useCanvasModelOptions(data.item.Type);
  const defaultImageModelId = useAtomValue(defaultImageModelIdAtom);
  const { item: storedItem, onHistory, onPatch, previewURL, queryTree, selectAsset, thumbnailURL } = data;
  const nodeSnapshot = useCanvasNodeSnapshot(data.nodePubSub, storedItem.NodeID);
  const generationFailure = nodeSnapshot.failure;
  const generationRuntimeState = nodeSnapshot.runtimeState;
  const isStoryboardDraft = storedItem.Type === canvasnode.CanvasNodeType.STORYBOARD_DRAFT;
  const item = (isGenerationType(storedItem.Type) || isStoryboardDraft ? nodeSnapshot.node : undefined) ?? storedItem;
  const persistedMediaURL =
    resolveArtifactURL(item.SelectedOutputURL ?? "") || resolveArtifactURL(item.PreviewURL ?? "");
  const mediaURL = isGenerationType(item.Type) ? persistedMediaURL || previewURL : previewURL || persistedMediaURL;
  const firstFrameURL = isGenerationType(item.Type)
    ? resolveArtifactURL(item.FirstFrameURL ?? "") || thumbnailURL
    : thumbnailURL || resolveArtifactURL(item.FirstFrameURL ?? "");
  const isVideo =
    item.Type === canvasnode.CanvasNodeType.VIDEO_ASSET || item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION;
  const isImage =
    item.Type === canvasnode.CanvasNodeType.IMAGE_ASSET || item.Type === canvasnode.CanvasNodeType.IMAGE_GENERATION;
  const isImageGeneration = item.Type === canvasnode.CanvasNodeType.IMAGE_GENERATION;
  const isGeneration = isGenerationType(item.Type);
  const materialMatching = useMaterialMatching(item.NodeID, nodeSnapshot.node ?? item);
  const cancellationDisabled =
    !materialMatching.matching &&
    item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION &&
    isVideoGenerationCancellationDisabled(
      generationRuntimeState?.taskRunId === item.ActiveTaskRunID ? generationRuntimeState?.providerStatus : undefined,
    );
  const currentSettings = settingsFromDTO(item.GenerationConfig);
  const imageSettings = {
    model: imageModelOptions.some((model) => model.id === currentSettings.model)
      ? currentSettings.model
      : defaultImageModelId,
    ratio: currentSettings.ratio,
    resolution: currentSettings.resolution,
    watermark: item.GenerationConfig?.Watermark === true,
  };
  const isAudio = item.Type === canvasnode.CanvasNodeType.AUDIO_ASSET;
  const isEmptyText = item.Type === canvasnode.CanvasNodeType.TEXT && !item.Text;
  const nodeTextContent = textNodeContent(item);
  const content = isEmptyText ? t("单击编辑文本") : nodeTextContent;
  const generationHasOutput =
    item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION ? Boolean(item.SelectedOutputText) : Boolean(mediaURL);
  const isEditing = editor.editingNodeId === item.NodeID && !isDeletedReferenceNode(item);
  const isWaitingForTextGeneration =
    item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION &&
    (textGenerationWaitingNodeIDs.has(item.NodeID) || (Boolean(item.ActiveTaskRunID) && !item.SelectedOutputText));
  const isStartingTextGeneration =
    item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION &&
    textGenerationWaitingNodeIDs.has(item.NodeID) &&
    !item.ActiveTaskRunID;
  const showGenerationLoadingBackground = shouldShowGenerationLoadingBackground({
    activeTaskRunID: materialMatching.matching ? undefined : item.ActiveTaskRunID,
    isTextGenerationWaiting: isWaitingForTextGeneration,
    type: item.Type,
  });
  const previewMode = isGeneration
    ? generationPreviewMode({
        hasOutput: generationHasOutput,
        isLoading: showGenerationLoadingBackground,
      })
    : undefined;
  const generationLoadingContainerClass =
    item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION ? styles.textGenerationWaiting : styles.placeholder;
  const isAutoSizedMedia = isImage || isVideo;
  const mediaPreview = useMediaNodePreviewSize(
    item.NodeID,
    isAutoSizedMedia && previewMode !== "loading" ? mediaURL : undefined,
    isGeneration ? MEDIA_GENERATION_DEFAULT_PREVIEW_SIZE : MEDIA_ASSET_DEFAULT_PREVIEW_SIZE,
  );
  return (
    <>
      {!isStoryboardDraft && isEditing ? (
        <CanvasNodeToolbar
          item={item}
          mediaURL={mediaURL ?? ""}
          onAddToLibrary={actions.addToLibrary}
          onCopy={actions.copy}
          onHistory={onHistory}
          onLargePreview={() => editor.openLargeTextPreview(item.NodeID)}
          onReview={actions.review}
          textContent={nodeTextContent}
        />
      ) : null}
      <CanvasNodeHeader item={item} onPatch={onPatch} reviewAsset={data.reviewAsset} />
      <div className={styles.nodeBody}>
        {!isStoryboardDraft ? <CanvasNodePort item={item} side="input" /> : null}
        <div
          className={`${styles.previewShell} ${
            isAudio ? styles.audioPreviewShell : ""
          } ${isAutoSizedMedia ? styles.autoSizedMediaPreviewShell : ""} canvas-node-drag-handle`}
          data-canvas-node-preview={item.NodeID}
          style={isAutoSizedMedia ? mediaPreview.style : undefined}
        >
          {isStoryboardDraft ? (
            <div className={`${styles.textPreview} nopan nowheel`}>
              <strong>
                {item.DraftSession?.status === 3
                  ? t("分镜脚本生成失败")
                  : item.DraftSession?.status === 2
                    ? t("分镜脚本待确认")
                    : t("分镜脚本生成中")}
              </strong>
              <Markdown className={styles.textPreviewMarkdown} data={item.Prompt ?? ""} />
            </div>
          ) : generationFailure && !item.ActiveTaskRunID ? (
            <CanvasGenerationFailureState
              code={generationFailure.errorCode}
              message={generationFailure.errorMessage}
              onRetry={() => editor.retry(item)}
              requestId={generationFailure.requestId ?? generationFailure.taskRunId}
              seedanceTaskId={generationFailure.seedanceTaskId}
              type={item.Type}
            />
          ) : isAudio ? (
            <>
              <div className={styles.audioArtwork}>
                <IconMusic />
              </div>
              {mediaURL ? (
                <AudioPlayer className={`${styles.audioPlayer} nodrag nopan nowheel`} src={mediaURL} />
              ) : null}
            </>
          ) : previewMode === "loading" ? (
            <div className={`${generationLoadingContainerClass} ${styles.generationLoading}`}>
              {item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION ? (
                <LoaderCircle aria-hidden className={styles.loadingNodeIcon} strokeWidth={1.5} />
              ) : (
                <CanvasNodeIcon
                  aria-hidden
                  className={styles.placeholderNodeIcon}
                  nodeType={item.Type}
                  strokeWidth={1.5}
                />
              )}
            </div>
          ) : previewMode === "empty" ? (
            <div className={styles.placeholder}>
              <CanvasNodeIcon
                aria-hidden
                className={styles.placeholderNodeIcon}
                nodeType={item.Type}
                strokeWidth={1.5}
              />
            </div>
          ) : mediaURL && isVideo ? (
            <CanvasNodeVideoPlayer
              dragging={dragging}
              onLoadedMetadata={mediaPreview.onVideoLoadedMetadata}
              poster={firstFrameURL}
              selected={selected}
              src={mediaURL}
            />
          ) : firstFrameURL && isVideo ? (
            <img alt={t("视频首帧")} className={styles.media} src={firstFrameURL} />
          ) : mediaURL && isImage ? (
            <img alt="" className={styles.media} onLoad={mediaPreview.onImageLoad} src={mediaURL} />
          ) : item.Type === canvasnode.CanvasNodeType.TEXT && isEditing ? (
            <>
              <div className={`${styles.textEditorShell} nodrag nopan nowheel`}>
                <CanvasTextEditor
                  expanded={editor.largeTextEditorNodeId === item.NodeID}
                  initialValue={item.Text ?? ""}
                  onChange={editor.changeDraft}
                  onCollapse={editor.collapseLargeTextEditor}
                  placeholder={t("请输入内容")}
                  queryTree={queryTree}
                  reviewAsset={actions.reviewAsset}
                  selectAsset={selectAsset}
                  title={item.Name || canvasNodeProtocol(item.Type).label}
                />
              </div>
              <CanvasTextResultOperations
                className={styles.textResultOperations}
                getText={editor.getDraft}
                text={nodeTextContent}
              />
            </>
          ) : item.Type === canvasnode.CanvasNodeType.TEXT ||
            item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION ? (
            <>
              <div
                className={`${styles.textPreview} ${isEmptyText ? styles.textPreviewPlaceholder : ""} nopan nowheel`}
              >
                <Markdown className={styles.textPreviewMarkdown} data={content} />
              </div>
              {nodeTextContent ? (
                <CanvasTextResultOperations className={styles.textResultOperations} text={nodeTextContent} />
              ) : null}
            </>
          ) : (
            <div className={styles.placeholder}>
              <CanvasNodeIcon
                aria-hidden
                className={styles.placeholderNodeIcon}
                nodeType={item.Type}
                strokeWidth={1.5}
              />
            </div>
          )}
          {materialMatching.matching ? (
            <CanvasGeneratingBadge
              statusLabel="素材匹配中..."
              stopLabel="取消匹配"
              disabled={materialMatching.cancelling || !editor.projectId}
              onStop={() => {
                if (editor.projectId) void materialMatching.cancel(editor.projectId, item.CanvasID);
              }}
            />
          ) : !isStoryboardDraft && (item.ActiveTaskRunID || isWaitingForTextGeneration) ? (
            <CanvasGeneratingBadge
              disabled={editor.saving || cancellationDisabled || !item.ActiveTaskRunID}
              disabledReason={cancellationDisabled ? t("视频已开始生成，无法取消") : undefined}
              onStop={() => editor.cancel(item)}
            />
          ) : null}
          <DeletedReferenceNotice item={item} />
        </div>
        {!isStoryboardDraft ? <CanvasNodePort item={item} side="output" /> : null}
      </div>
      {isGeneration && isEditing ? (
        <div className={styles.promptEditorOverlay}>
          <CanvasPromptEditor
            onSave={editor.save}
            matchTarget={item}
            matchProjectId={editor.projectId}
            actionDisabled={editor.saving || isStartingTextGeneration}
            disabled={editor.saving || isStartingTextGeneration || Boolean(item.ActiveTaskRunID)}
            footer={
              isImageGeneration ? (
                <GenerationConfiguration
                  compact
                  disabled={editor.saving || Boolean(item.ActiveTaskRunID)}
                  imageSettings={imageSettings}
                  modelOptions={imageModelOptions}
                  onImageSettingsChange={(next) => {
                    const patch = generationConfigPatch(currentSettings, {
                      ...currentSettings,
                      model: next.model,
                      ratio: next.ratio,
                      resolution: next.resolution,
                      watermark: next.watermark ? t("有水印") : t("无水印"),
                    });
                    if (Object.keys(patch).length > 0) {
                      void onPatch(item, { GenerationConfig: patch });
                    }
                  }}
                  parameters="image"
                  popupPosition="top"
                />
              ) : item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION ? (
                <GenerationConfiguration
                  compact
                  disabled={Boolean(item.ActiveTaskRunID)}
                  generationMode={item.VideoInputMode ?? canvasnode.CanvasVideoInputMode.REFERENCE}
                  modelOptions={modelOptions}
                  onGenerationModeChange={(next) => {
                    void onPatch(item, { VideoInputMode: next });
                  }}
                  onVideoSettingsChange={(next) => {
                    const patch = generationConfigPatch(
                      settingsFromDTO(item.GenerationConfig),
                      next,
                      item.VideoInputMode,
                    );
                    if (Object.keys(patch).length > 0) {
                      void onPatch(item, { GenerationConfig: patch });
                    }
                  }}
                  parameters="video"
                  popupPosition="top"
                  videoSettings={settingsFromDTO(item.GenerationConfig)}
                />
              ) : (
                <CanvasModelSelect
                  disabled={editor.saving || Boolean(item.ActiveTaskRunID)}
                  item={item}
                  modelOptions={modelOptions}
                  onPatch={onPatch}
                />
              )
            }
            generating={Boolean(item.ActiveTaskRunID) && !materialMatching.matching}
            cancelDisabled={cancellationDisabled}
            initialValue={item.Prompt}
            onCancel={() => editor.cancel(item)}
            onChange={editor.changeDraft}
            onGenerate={() => editor.generate(item)}
            onSwapFrames={() => editor.swapFrames(item)}
            queryTree={queryTree}
            references={data.referenceAssets}
            reviewAsset={actions.reviewAsset}
            selectAsset={selectAsset}
            title={item.Name || canvasNodeProtocol(item.Type).label}
            variant={
              isImageGeneration ? "image" : item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION ? "video" : "text"
            }
            videoInputMode={item.VideoInputMode}
          />
        </div>
      ) : null}
      {item.Type === canvasnode.CanvasNodeType.TEXT_GENERATION ? (
        <CanvasTextGenerationPreview
          content={item.SelectedOutputText ?? ""}
          onClose={editor.collapseLargeTextPreview}
          title={item.Name || canvasNodeProtocol(item.Type).label}
          visible={editor.largeTextPreviewNodeId === item.NodeID && Boolean(item.SelectedOutputText)}
        />
      ) : null}
    </>
  );
}, canvasCardPropsEqual);

export const nodeTypes: NodeTypes = { canvasNode: CanvasCard };
