import { fetchCanvasSettings } from "@repo/api";
import { useEffect, useRef, useState } from "react";

import {
  DEFAULT_IMAGE_GENERATION_SETTINGS,
  type ImageGenerationSettings,
} from "@/components/GenerationConfiguration/index";
import { ImageGenerationEditor } from "@/components/ImageGeneration/ImageGenerationEditor";
import { ImageGenerationEditorDialog } from "@/components/ImageGeneration/ImageGenerationEditorDialog";
import { Message } from "@/components/ui";
import { resource } from "@/domain";
import { resolveArtifactURL } from "@/utils/artifactURL";
import t from "@/utils/i18n";

import { categoryFromFile, revokeAssetBlobUrls } from "../../studio/domain/model";
import type { StoryboardAsset } from "../../studio/domain/types";
import { ResourceAssetDetailDialog } from "../assets/ResourceAssetDetailDialog";
import { useResourceUpload } from "../assets/useResourceUpload";
import {
  ASPECT_RATIO_FROM_API,
  ASPECT_RATIO_TO_API,
  RESOLUTION_FROM_API,
  RESOLUTION_TO_API,
  cancelResourceAssetGeneration,
  getResourceAssetGeneration,
  getResourceAssetGenerationRun,
  startResourceAssetGeneration,
  updateResourceAssetGeneration,
} from "../domain/actions";
import {
  IMAGE_MAX_SIZE_BYTES,
  getResourceGenerationPromptPlaceholder,
  validateResourceFile,
} from "../domain/resourceTypes";
import { type ImageGenerationModelOption, listImageGenerationModels } from "./imageModels";

/** 生图新建视图无单独“保存”按钮：编辑内容防抖后默认落库，退出不丢失。 */
const AUTO_SAVE_DELAY_MS = 500;
const RUN_POLL_INTERVAL_MS = 2000;

interface UploadedReference extends StoryboardAsset {
  /** 参考图对应的服务端 AssetID；上传成功后回填，未成功前用于占位。 */
  assetId?: string;
}

/**
 * 「新建」形象/素材的 AI 生成编辑器（已接入服务端生成配置）。
 *
 * 数据流：父层在用户点击“新建”时创建槽位 + 服务端生成草稿，创建成功后进入本编辑器；
 * prompt / 参考图 / 生成参数编辑后按“默认保存”经 UpdateResourceAssetGeneration 落库
 * （无单独保存按钮）；点“生成”走 Start + 轮询 Run，成功后产物自动选中；
 * 生成中“停止”调 Cancel 回退到发起前的图；退出（取消/X）不做二次确认、不额外保存。
 */
export function ResourceAssetCreateView({
  slot,
  busy = false,
  projectId,
  resourceId,
  resourceType = resource.ResourceType.CHARACTER,
  materialName,
  onBack,
  onDownload,
  onGenerated,
  onGeneratingChange,
  onRename,
  onReview,
  onSetPrimary,
}: {
  slot: resource.ResourceAsset;
  busy?: boolean;
  projectId: string;
  resourceId: string;
  resourceType?: resource.ResourceType;
  materialName: string;
  onBack: () => void;
  onDownload?: () => void;
  /** 生成成功或有落库变更后回调父层刷新列表。 */
  onGenerated: () => void;
  onGeneratingChange?: (activeTaskRunId?: string) => void;
  onRename?: (name: string) => Promise<boolean>;
  onReview?: () => void;
  onSetPrimary?: () => unknown | Promise<unknown>;
}) {
  // 槽位与草稿 Revision：默认保存的乐观锁基准，每次落库后更新。
  const slotRef = useRef(slot);
  const revisionRef = useRef<number>(0);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persistQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeRunRef = useRef<string | undefined>(undefined);
  const onGeneratingChangeRef = useRef(onGeneratingChange);
  onGeneratingChangeRef.current = onGeneratingChange;
  const uploadResourceFile = useResourceUpload();

  const name = slot.Name;
  const [prompt, setPrompt] = useState("");
  const [references, setReferences] = useState<UploadedReference[]>([]);
  const [settings, setSettings] = useState<ImageGenerationSettings>(DEFAULT_IMAGE_GENERATION_SETTINGS);
  const [modelOptions, setModelOptions] = useState<ImageGenerationModelOption[]>([]);
  const [configuredDefaultImageModelId, setConfiguredDefaultImageModelId] = useState("");
  const [modelsLoading, setModelsLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>(slot.PreviewURL);
  const [generating, setGenerating] = useState(false);
  const [generationLoading, setGenerationLoading] = useState(true);
  const [generationFailure, setGenerationFailure] = useState<{
    code?: string;
    message?: string;
  }>();
  const [editorExpanded, setEditorExpanded] = useState(false);
  const [settingsError, setSettingsError] = useState<string>();

  useEffect(() => {
    if (slot.PreviewURL) setPreviewUrl(slot.PreviewURL);
  }, [slot.PreviewURL]);

  const defaultImageModelId = modelOptions.some((item) => item.id === configuredDefaultImageModelId)
    ? configuredDefaultImageModelId
    : (modelOptions[0]?.id ?? "");
  const effectiveSettings = settings.model ? settings : { ...settings, model: defaultImageModelId };
  const latestDraftRef = useRef({
    prompt,
    references,
    settings: effectiveSettings,
  });
  latestDraftRef.current = { prompt, references, settings: effectiveSettings };
  const selectedModel = modelOptions.find((item) => item.id === effectiveSettings.model);
  const referenceLimit = selectedModel?.referenceImageLimit ?? 0;
  const supportsImageToImage = Boolean(selectedModel?.supportsImageToImage);
  const requiresReference = Boolean(selectedModel?.supportsImageToImage && !selectedModel.supportsTextToImage);
  const referencesAreValid =
    (supportsImageToImage || references.length === 0) && (!requiresReference || references.length > 0);
  const canGenerate =
    Boolean(name.trim() && prompt.trim() && selectedModel) &&
    referencesAreValid &&
    !settingsError &&
    !generating &&
    !generationLoading &&
    !modelsLoading;

  useEffect(() => {
    let active = true;
    setModelOptions([]);
    setConfiguredDefaultImageModelId("");
    setModelsLoading(true);
    Promise.all([
      listImageGenerationModels(projectId),
      fetchCanvasSettings().catch(() => {
        if (active) {
          Message.warning(t("默认模型配置加载失败，已使用项目可用模型"));
        }
        return undefined;
      }),
    ])
      .then(([options, defaultModels]) => {
        if (!active) return;
        setModelOptions(options);
        setConfiguredDefaultImageModelId(defaultModels?.defaults.image?.provider_id ?? "");
      })
      .catch(() => {
        if (active) Message.error(t("模型列表加载失败"));
      })
      .finally(() => {
        if (active) setModelsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  useEffect(() => {
    let active = true;
    setGenerationLoading(true);
    setGenerationFailure(undefined);
    getResourceAssetGeneration(projectId, resourceId, slot.ResourceAssetID)
      .then((generation) => {
        if (!active) return;
        revisionRef.current = generation.Revision;
        setPrompt(generation.Prompt);
        if (generation.ActiveTaskRunID) {
          activeRunRef.current = generation.ActiveTaskRunID;
          setGenerating(true);
          onGeneratingChangeRef.current?.(generation.ActiveTaskRunID);
          pollRun(generation.ActiveTaskRunID);
        } else if (generation.LatestRun?.Status === resource.ResourceAssetGenerationRunStatus.FAILED) {
          setGenerationFailure({
            code: generation.LatestRun.ErrorCode,
            message: generation.LatestRun.ErrorMessage,
          });
        }
        setReferences(
          generation.UploadedReferences.map((reference, index) => ({
            id: reference.AssetID,
            assetId: reference.AssetID,
            category: "image",
            title: reference.FileName ?? t("参考图 {index}", { index: index + 1 }),
            description: t("参考图"),
            thumbnail: reference.PreviewURL ? resolveArtifactURL(reference.PreviewURL) : undefined,
            previewUrl: reference.PreviewURL ? resolveArtifactURL(reference.PreviewURL) : undefined,
            source: "canvasnode",
            syncStatus: "ready",
          })),
        );
        setSettings((current) => ({
          ...current,
          model: generation.ModelID,
          ratio: (generation.AspectRatio && ASPECT_RATIO_FROM_API[generation.AspectRatio]) || current.ratio,
          resolution: (generation.Resolution && RESOLUTION_FROM_API[generation.Resolution]) || current.resolution,
          watermark: generation.Watermark,
        }));
      })
      .catch(() => {
        if (active) Message.error(t("生成配置加载失败"));
      })
      .finally(() => {
        if (active) setGenerationLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, resourceId, slot.ResourceAssetID]);

  // 卸载时清理定时器、blob 预览并停止未完成的生成轮询。
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      if (pollTimer.current) clearTimeout(pollTimer.current);
      activeRunRef.current = undefined;
      revokeAssetBlobUrls(references);
    };
    // 仅在卸载时执行清理。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buildPatch = (referenceOverride?: UploadedReference[]): resource.ResourceAssetGenerationPatch => {
    const latestDraft = latestDraftRef.current;
    const generationReferences = referenceOverride ?? latestDraft.references;
    const patch: resource.ResourceAssetGenerationPatch = {
      Prompt: latestDraft.prompt,
      ModelID: latestDraft.settings.model,
      Watermark: latestDraft.settings.watermark,
      UploadedReferences: generationReferences.flatMap<resource.ResourceAssetGenerationUploadedReferenceInput>(
        (ref) => {
          if (ref.assetId) return [{ AssetID: ref.assetId }];
          if (ref.blobId) {
            return [
              {
                BlobID: ref.blobId,
                FileName: ref.pendingFile?.name ?? ref.title,
              },
            ];
          }
          return [];
        },
      ),
      ResourceReferences: [],
    };
    const ratio = ASPECT_RATIO_TO_API[latestDraft.settings.ratio];
    if (ratio !== undefined) patch.AspectRatio = ratio;
    const resolution = RESOLUTION_TO_API[latestDraft.settings.resolution];
    if (resolution !== undefined) patch.Resolution = resolution;
    return patch;
  };

  // 默认保存：把当前 prompt/参考图/参数落库到服务端生成配置，更新乐观锁 Revision。
  const persist = (referenceOverride?: UploadedReference[]): Promise<UploadedReference[] | undefined> => {
    const execute = async () => {
      const slot = slotRef.current;
      if (!slot) return undefined;
      const generation = await updateResourceAssetGeneration(
        projectId,
        resourceId,
        slot.ResourceAssetID,
        buildPatch(referenceOverride),
        revisionRef.current,
      );
      revisionRef.current = generation.Revision;
      if (referenceOverride && generation.UploadedReferences?.length === referenceOverride.length) {
        const persistedReferences = referenceOverride.map((reference, index) => ({
          ...reference,
          assetId: generation.UploadedReferences[index].AssetID,
          blobId: undefined,
          syncStatus: "ready" as const,
        }));
        setReferences(persistedReferences);
        return persistedReferences;
      }
      return referenceOverride;
    };
    const queued = persistQueueRef.current.then(execute, execute);
    persistQueueRef.current = queued.then(
      () => undefined,
      () => undefined,
    );
    return queued;
  };

  // prompt / 参考图 / 参数变更后防抖落库（无单独保存按钮）。
  const scheduleAutoSave = () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      void persist().catch(() => {
        // 后台自动保存失败不打断编辑；后续编辑或生成前会再次尝试落库。
      });
    }, AUTO_SAVE_DELAY_MS);
  };

  const handleUpload = async (files: File[]) => {
    if (!supportsImageToImage) {
      Message.warning(t("当前模型不支持参考图"));
      return;
    }
    const room = referenceLimit - references.length;
    if (room <= 0) {
      Message.warning(t("当前模型最多支持 {max} 张参考图", { max: referenceLimit }));
      return;
    }
    const accepted = files.slice(0, room);
    let nextReferences = [...references];
    for (const file of accepted) {
      const validationError = validateResourceFile(resource.ResourceType.CHARACTER, file);
      if (validationError) {
        Message.error(validationError);
        continue;
      }
      if (file.size > IMAGE_MAX_SIZE_BYTES) continue;
      const draftId = `ref-${references.length}-${file.name}`;
      const preview = URL.createObjectURL(file);
      const placeholder: UploadedReference = {
        id: draftId,
        draftId,
        category: categoryFromFile(file),
        title: file.name,
        description: t("参考图"),
        thumbnail: file.type.startsWith("image/") ? preview : undefined,
        previewUrl: preview,
        pendingFile: file,
        source: "canvasnode",
        syncStatus: "uploading",
      };
      nextReferences.push(placeholder);
      setReferences([...nextReferences]);
      try {
        const blobId = await uploadResourceFile(file);
        nextReferences[nextReferences.length - 1] = {
          ...placeholder,
          blobId,
          syncStatus: "uploaded",
        };
        setReferences([...nextReferences]);
        // 图片上传成功后立即更新当前生成草稿。先取消待执行的通用自动保存，
        // 避免它抢先更新 revision，导致 BlobID 关联请求发生乐观锁冲突。
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = undefined;
        nextReferences = (await persist(nextReferences)) ?? nextReferences;
      } catch (reason) {
        const failedIndex = nextReferences.findIndex((reference) => reference.draftId === placeholder.draftId);
        if (failedIndex >= 0) {
          nextReferences[failedIndex] = {
            ...nextReferences[failedIndex],
            syncStatus: "failed",
          };
          setReferences([...nextReferences]);
        }
        Message.error(reason instanceof Error ? reason.message : t("参考图关联失败"));
      }
    }
  };

  const handleRemoveReference = (id: string) => {
    setReferences((current) => {
      const removed = current.find((asset) => asset.id === id || asset.draftId === id);
      if (removed) revokeAssetBlobUrls([removed]);
      return current.filter((asset) => asset !== removed);
    });
    scheduleAutoSave();
  };

  const stopPolling = () => {
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollTimer.current = undefined;
  };

  // 轮询生成 Run 直至终态：成功回填产物预览并自动选中，失败/取消回退。
  const pollRun = (runId: string) => {
    const slot = slotRef.current;
    if (!slot) return;
    const tick = async () => {
      try {
        const run = await getResourceAssetGenerationRun(projectId, resourceId, slot.ResourceAssetID, runId);
        if (activeRunRef.current !== runId) return;
        if (run.Status === resource.ResourceAssetGenerationRunStatus.SUCCEEDED) {
          activeRunRef.current = undefined;
          setGenerating(false);
          setGenerationFailure(undefined);
          onGeneratingChangeRef.current?.(undefined);
          onGenerated();
          Message.success(t("生成成功"));
          return;
        }
        if (
          run.Status === resource.ResourceAssetGenerationRunStatus.FAILED ||
          run.Status === resource.ResourceAssetGenerationRunStatus.CANCELLED
        ) {
          activeRunRef.current = undefined;
          setGenerating(false);
          onGeneratingChangeRef.current?.(undefined);
          if (run.Status === resource.ResourceAssetGenerationRunStatus.FAILED) {
            setGenerationFailure({
              code: run.ErrorCode,
              message: run.ErrorMessage,
            });
            Message.error(run.ErrorMessage || run.ErrorCode || t("生成失败，请重试"));
          }
          return;
        }
        pollTimer.current = setTimeout(tick, RUN_POLL_INTERVAL_MS);
      } catch {
        if (activeRunRef.current !== runId) return;
        pollTimer.current = setTimeout(tick, RUN_POLL_INTERVAL_MS);
      }
    };
    void tick();
  };

  const handleGenerate = async () => {
    const slot = slotRef.current;
    if (settingsError) {
      Message.error(settingsError);
      return;
    }
    if (!slot || !canGenerate) return;
    setGenerationFailure(undefined);
    setGenerating(true);
    try {
      // 发起前先默认保存最新编辑，保证服务端配置与界面一致。
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
      await persist();
      const runId = await startResourceAssetGeneration(
        projectId,
        resourceId,
        slot.ResourceAssetID,
        revisionRef.current,
      );
      activeRunRef.current = runId;
      onGeneratingChangeRef.current?.(runId);
      pollRun(runId);
    } catch (reason) {
      setGenerating(false);
      Message.error(reason instanceof Error ? reason.message : t("发起生成失败"));
    }
  };

  // 生图停止：中止当前生成过程（≠ 退出弹窗），回退到发起前的图。
  const handleStop = async () => {
    const slot = slotRef.current;
    const runId = activeRunRef.current;
    if (!slot || !runId) return;
    stopPolling();
    activeRunRef.current = undefined;
    setGenerating(false);
    onGeneratingChangeRef.current?.(undefined);
    try {
      await cancelResourceAssetGeneration(projectId, resourceId, slot.ResourceAssetID, runId);
    } catch {
      // 停止失败不阻断交互；后端 run 最终会走向终态。
    }
  };

  const handleSettingsChange = (next: ImageGenerationSettings) => {
    setSettings(next);
    scheduleAutoSave();
  };

  const editorProps = {
    canGenerate,
    generating,
    modelOptions,
    modelsLoading: modelsLoading || generationLoading,
    onPromptChange: (nextPrompt: string) => {
      setPrompt(nextPrompt);
      scheduleAutoSave();
    },
    onReferenceRemove: handleRemoveReference,
    onReferenceUpload: handleUpload,
    onSettingsChange: handleSettingsChange,
    onSettingsValidationChange: setSettingsError,
    popupPosition: "top" as const,
    prompt,
    promptPlaceholder: getResourceGenerationPromptPlaceholder(resourceType, materialName),
    referenceImageLimit: referenceLimit,
    references,
    requiresReference,
    selectedModel,
    settings: effectiveSettings,
    settingsError,
    supportsImageToImage,
  };

  return (
    <ResourceAssetDetailDialog
      asset={{ ...slot, Name: name, PreviewURL: previewUrl }}
      busy={busy || generating}
      generationFailure={generationFailure ? { ...generationFailure, onRetry: handleGenerate } : undefined}
      generating={generating}
      loading={generating && !previewUrl}
      materialName={materialName}
      resourceType={resource.ResourceType.CHARACTER}
      onClose={onBack}
      onDownload={onDownload}
      onRename={onRename}
      onReview={onReview}
      onSetPrimary={onSetPrimary}
      onStopGeneration={handleStop}
    >
      <ImageGenerationEditor {...editorProps} onExpand={() => setEditorExpanded(true)} onGenerate={handleGenerate} />
      <ImageGenerationEditorDialog
        {...editorProps}
        onClose={() => setEditorExpanded(false)}
        onGenerate={() => {
          setEditorExpanded(false);
          return handleGenerate();
        }}
        title={name}
        visible={editorExpanded}
      />
    </ResourceAssetDetailDialog>
  );
}
