import { RefreshCw as IconRefresh, ChevronLeft as IconLeft, Plus as IconPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { agentframeService } from "@/api/index";
import emptyIllustration from "@/assets/storyboard-empty.png";
import { AssetReviewModal } from "@/components/AssetReviewModal/index";
import { AudioPlayer } from "@/components/audioPlayer/index";
import { useAudioSpectrum } from "@/components/AudioSpectrum/index";
import { Pagination, Result, openDeleteConfirmModal } from "@/components/compat";
import { Message, Spin, Button, Dropdown, Menu } from "@/components/ui";
import { asset, resource } from "@/domain";
import { latestAssetReview } from "@/utils/assetReview";
import { downloadWithFetch } from "@/utils/download";
import t from "@/utils/i18n";
import { resolveUpPreviewURL } from "@/utils/upPreviewURL";

import { SearchInput } from "../../../components/SearchInput";
import { BatchActionBar } from "../components/BatchActionBar";
import { RESOURCE_ASSETS_POPUP_Z_INDEX, RESOURCE_ASSET_DETAIL_MODAL_Z_INDEX } from "../components/resourceAssetsLayers";
import {
  addResourceFile,
  batchDeleteResourceFiles,
  createGeneratedResourceAsset,
  deleteResourceFile,
  getResource,
  renameResourceFile,
  replaceUploadedResourceAsset,
  setPrimaryResourceFile,
} from "../domain/actions";
import {
  RESOURCE_PAGE_SIZE_OPTIONS,
  normalizeResourcePageSize,
  shouldHideResourcePagination,
} from "../domain/paginationRules";
import { getResourceFileConfig, validateResourceFile } from "../domain/resourceTypes";
import { ResourceAssetCreateView } from "../generation/ResourceAssetCreateView";
import { ResourceAssetCard } from "./ResourceAssetCard";
import { ResourceAssetDetailModal } from "./ResourceAssetDetailModal";
import { useResourceAssetList } from "./useResourceAssetList";
import { useResourceAssetStatus } from "./useResourceAssetStatus";
import { useResourceUpload } from "./useResourceUpload";

import styles from "./ResourceAssetsPage.module.less";

const FILE_EXTENSION_PATTERN = /\.[a-z\d]{1,10}$/i;
const INVALID_FILE_NAME_CHARACTERS = /[\\/:*?"<>|]/g;

function urlFileExtension(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    for (const candidate of [parsed.pathname, ...parsed.searchParams.values()]) {
      const extension = candidate.match(FILE_EXTENSION_PATTERN)?.[0];
      if (extension) return extension;
    }
  } catch {
    // A resolved preview URL should be valid; an extension is optional if it is not.
  }
  return "";
}

function imageDownloadName(resourceName: string, fileName: string, url: string) {
  const nameExtension = fileName.match(FILE_EXTENSION_PATTERN)?.[0];
  const extension = nameExtension ?? urlFileExtension(url);
  const childName = nameExtension ? fileName.slice(0, -nameExtension.length) : fileName;
  const readableName = [resourceName, childName]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("-")
    .replace(INVALID_FILE_NAME_CHARACTERS, "-");
  return `${readableName || "download"}${extension}`;
}

export type ResourceAssetsInitialAction = { id: number; type: "create" } | { file: File; id: number; type: "upload" };

export function ResourceAssetsPageContent({
  initialAction,
  item,
  projectId,
  resourceId: resourceIdProp,
  onClose,
  onChange,
}: {
  initialAction?: ResourceAssetsInitialAction;
  item?: resource.Resource;
  projectId: string;
  resourceId?: string;
  onClose: (resourceType: resource.ResourceType) => void;
  onChange: () => void;
}) {
  const uploadResource = useResourceUpload();
  const inputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const mutationRef = useRef(false);
  const createSequenceRef = useRef(0);
  const handledInitialActionIdRef = useRef<number>();
  const [uploading, setUploading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [reviewFiles, setReviewFiles] = useState<resource.ResourceAsset[]>([]);
  const [batchSelecting, setBatchSelecting] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [creatingGenerated, setCreatingGenerated] = useState(false);
  const [createdSlot, setCreatedSlot] = useState<resource.ResourceAsset>();
  const [detailFile, setDetailFile] = useState<resource.ResourceAsset>();
  // 音效试听：一次只播一个。
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioSpectrum = useAudioSpectrum(audioRef);
  const [playingId, setPlayingId] = useState("");
  const resourceId = resourceIdProp ?? item?.ResourceID ?? "";
  const onFilesLoaded = useCallback((items: resource.ResourceAsset[]) => {
    setCreatedSlot((current) =>
      current ? (items.find((file) => file.ResourceAssetID === current.ResourceAssetID) ?? current) : current,
    );
    setDetailFile((current) =>
      current ? (items.find((file) => file.ResourceAssetID === current.ResourceAssetID) ?? current) : current,
    );
  }, []);
  const {
    files,
    setFiles,
    total,
    pageNum,
    setPageNum,
    pageSize,
    setPageSize,
    currentResource,
    setCurrentResource,
    loading,
    error,
    setError,
    keyword,
    setKeyword,
    debouncedKeyword,
    load,
    resetList,
    invalidateLoad,
  } = useResourceAssetList({
    projectId,
    resourceId,
    item,
    onLoaded: onFilesLoaded,
  });
  const resourceType = currentResource?.Type ?? item?.Type;
  const isCharacter = resourceType === resource.ResourceType.CHARACTER;
  const isAudio = resourceType === resource.ResourceType.AUDIO;
  // 官方资源（预置音色）只读：禁上传/新建/改名/替换/删除，仅保留试听与下载。
  const isOfficial =
    ((currentResource ?? item)?.OwnerType ?? resource.ResourceOwnerType.PROJECT) ===
    resource.ResourceOwnerType.OFFICIAL;
  const materialName = isCharacter ? t("形象") : t("素材");
  const emptyMaterialType = isCharacter ? t("形象") : isAudio ? t("音频") : t("素材");

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  const { generatingFileIds, generationFailures, stopGeneration, updateGenerationRun, resetGenerationFailures } =
    useResourceAssetStatus({
      files,
      setFiles,
      projectId,
      resourceId,
      load,
      onChange,
    });

  useEffect(() => {
    resetList();
    setReviewFiles([]);
    setBatchSelecting(false);
    setSelectedFileIds(new Set());
    setRenamingId("");
    setKeyword("");
    createSequenceRef.current += 1;
    setCreatingGenerated(false);
    setCreatedSlot(undefined);
    setDetailFile(undefined);
    resetGenerationFailures();
    // 切换资源时停止正在进行的音效试听，避免跨资源残留播放。
    audioRef.current?.pause();
    setPlayingId("");
    return () => {
      invalidateLoad();
      createSequenceRef.current += 1;
    };
  }, [item, resourceId]);

  useEffect(() => {
    if (resourceId) void load();
  }, [load, resourceId]);

  const mutate = async (operation: (resourceId: string, revision: number) => Promise<unknown>) => {
    if (!resourceId || mutationRef.current) return false;
    mutationRef.current = true;
    setMutating(true);
    try {
      setError("");
      const authoritative = await getResource(agentframeService, projectId, resourceId);
      setCurrentResource(authoritative);
      await operation(resourceId, authoritative.Revision);
      await load(false);
      onChange();
      return true;
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : t("操作失败，请重试");
      await load(false);
      setError(message);
      return false;
    } finally {
      mutationRef.current = false;
      setMutating(false);
    }
  };

  const busy = loading || uploading || mutating || creatingGenerated;
  const visibleFiles = files;
  const selectedFiles = visibleFiles.filter((file) => selectedFileIds.has(file.ResourceAssetID));

  const toggleFile = (resourceAssetId: string) => {
    if (generatingFileIds.has(resourceAssetId)) return;
    setSelectedFileIds((current) => {
      const next = new Set(current);
      if (next.has(resourceAssetId)) next.delete(resourceAssetId);
      else next.add(resourceAssetId);
      return next;
    });
  };

  const saveRename = (file: resource.ResourceAsset) => {
    const nextName = renameValue.trim();
    if (!nextName || nextName === file.Name) {
      setRenamingId("");
      return;
    }
    void mutate((resourceId, revision) =>
      renameResourceFile(agentframeService, projectId, resourceId, file, revision, nextName),
    ).then((success) => {
      if (success) setRenamingId("");
    });
  };

  const startRename = (file: resource.ResourceAsset) => {
    if (busy || generatingFileIds.has(file.ResourceAssetID)) return;
    setRenamingId(file.ResourceAssetID);
    setRenameValue(file.Name);
  };

  const uploadFile = async (file: File) => {
    if (!resourceId) return;
    const fileType = currentResource?.Type ?? item?.Type ?? resource.ResourceType.CHARACTER;
    const validationError = validateResourceFile(fileType, file);
    if (validationError) {
      Message.error(validationError);
      return;
    }
    setUploading(true);
    await mutate(async (targetResourceId, revision) => {
      const blobId = await uploadResource(file);
      await addResourceFile(agentframeService, projectId, targetResourceId, revision, { blobId, fileName: file.name });
    });
    setUploading(false);
  };

  const openCreate = () => {
    const target = currentResource ?? item;
    if (!target || loading || creatingGenerated) return;
    const sequence = ++createSequenceRef.current;
    setCreatingGenerated(true);
    setCreatedSlot(undefined);
    void createGeneratedResourceAsset(agentframeService, projectId, target.ResourceID, target.Revision)
      .then((slot) => {
        if (sequence !== createSequenceRef.current) return;
        setCreatedSlot(slot);
        void load(false);
        onChange();
      })
      .catch((reason: unknown) => {
        if (sequence !== createSequenceRef.current) return;
        Message.error(reason instanceof Error ? reason.message : t("创建{materialName}失败，请重试", { materialName }));
      })
      .finally(() => {
        if (sequence === createSequenceRef.current) setCreatingGenerated(false);
      });
  };

  useEffect(() => {
    if (
      !initialAction ||
      !currentResource ||
      loading ||
      creatingGenerated ||
      handledInitialActionIdRef.current === initialAction.id
    ) {
      return;
    }
    handledInitialActionIdRef.current = initialAction.id;
    if (initialAction.type === "upload") void uploadFile(initialAction.file);
    else openCreate();
  }, [creatingGenerated, currentResource, initialAction, loading]);

  const openGeneratedEditor = async (file: resource.ResourceAsset) => {
    const sequence = ++createSequenceRef.current;
    setCreatingGenerated(false);
    setDetailFile(undefined);
    const refreshedFiles = await load(false);
    if (sequence !== createSequenceRef.current) return;
    setCreatedSlot(refreshedFiles?.find((current) => current.ResourceAssetID === file.ResourceAssetID) ?? file);
  };

  const backToList = () => {
    createSequenceRef.current += 1;
    setCreatingGenerated(false);
    setCreatedSlot(undefined);
    setDetailFile(undefined);
  };

  const openUploadedDetail = (file: resource.ResourceAsset) => {
    setCreatedSlot(undefined);
    setDetailFile(file);
  };

  const openMaterialEditor = (file: resource.ResourceAsset) => {
    if (file.SourceType === resource.ResourceAssetSourceType.GENERATED) {
      void openGeneratedEditor(file);
      return;
    }
    openUploadedDetail(file);
  };

  const toggleAudioPlayback = (file: resource.ResourceAsset) => {
    const element = audioRef.current;
    const src = file.PreviewURL ? resolveUpPreviewURL(file.PreviewURL) : undefined;
    if (!element || !src) return;
    // 再次点击当前正在播放的音效则停止；否则切换到新音效（互斥单播）。
    if (playingId === file.ResourceAssetID) {
      element.pause();
      return;
    }
    element.src = src;
    void audioSpectrum.prepare();
    void element.play().then(
      () => setPlayingId(file.ResourceAssetID),
      () => setPlayingId(""),
    );
  };

  const downloadAsset = (file: resource.ResourceAsset) => {
    const src = file.PreviewURL ? resolveUpPreviewURL(file.PreviewURL) : undefined;
    if (!src) return;
    if (file.MediaType === asset.AssetMediaType.IMAGE) {
      void downloadWithFetch({
        name: imageDownloadName(currentResource?.Name ?? item?.Name ?? "", file.Name, src),
        url: src,
      });
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = src;
    anchor.download = file.Name || "download";
    anchor.rel = "noreferrer";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const openReview = (file: resource.ResourceAsset) => {
    const assetId = file.CurrentAssetID;
    if (!assetId) return;
    setReviewFiles([file]);
  };

  const setAsPrimary = (file: resource.ResourceAsset) =>
    void mutate((targetResourceId, revision) =>
      setPrimaryResourceFile(agentframeService, projectId, targetResourceId, file.ResourceAssetID, revision),
    );

  const confirmRemove = (file: resource.ResourceAsset) => {
    openDeleteConfirmModal({
      name: materialName,
      targetName: file.Name,
      info: <span className="block px-6">{t("移除后不可恢复，请谨慎操作。")}</span>,
      async onOk() {
        await mutate((targetResourceId, revision) =>
          deleteResourceFile(agentframeService, projectId, targetResourceId, file, revision),
        );
      },
    });
  };

  const confirmBatchRemove = () => {
    if (!selectedFiles.length) return;
    openDeleteConfirmModal({
      name: t("素材"),
      targetName: t("已选 {count} 项", { count: selectedFiles.length }),
      info: <span className="block px-6">{t("移除后不可恢复，请谨慎操作。")}</span>,
      async onOk() {
        if (!resourceId || mutationRef.current) return;
        mutationRef.current = true;
        setMutating(true);
        setError("");
        try {
          const authoritative = await getResource(agentframeService, projectId, resourceId);
          await batchDeleteResourceFiles(
            agentframeService,
            projectId,
            resourceId,
            selectedFiles,
            authoritative.Revision,
          );
          setSelectedFileIds(new Set());
          setBatchSelecting(false);
          onChange();
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : t("操作失败，请重试"));
        } finally {
          await load(false);
          mutationRef.current = false;
          setMutating(false);
        }
      },
    });
  };

  return (
    <main className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center gap-3 p-5">
        <Button
          aria-label={t("返回资产库")}
          className="flex! items-center! justify-center!"
          disabled={busy}
          icon={<IconLeft className="text-[14px]" />}
          onClick={() => onClose(resourceType ?? resource.ResourceType.CHARACTER)}
          size="mini"
        />
        <h1 className="m-0 text-[20px] font-semibold leading-7 text-foreground">
          {currentResource?.Name ?? item?.Name ?? t("资产")}
        </h1>
        <span className="shrink-0 text-[20px] leading-7 text-muted-foreground">
          {t("共 {count} 个{materialName}", {
            count: total,
            materialName,
          })}
        </span>
      </header>
      <section className="min-h-0 flex-1 overflow-visible px-5 pb-5 pt-3">
        <div className="flex h-full min-h-0 flex-col overflow-visible">
          <>
            <div className="mb-6 flex flex-none items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <SearchInput
                  className="w-[200px]"
                  disabled={batchSelecting}
                  onChange={(value) => {
                    setKeyword(value);
                    setPageNum(1);
                  }}
                  placeholder={t("输入资产名称搜索")}
                  value={keyword}
                />
              </div>
              <div className="flex items-center gap-3">
                {isOfficial ? (
                  <span className="inline-flex items-center rounded-[8px] bg-muted px-3 py-[6px] text-[13px] text-foreground">
                    {t("官方预置，仅支持试听与下载")}
                  </span>
                ) : isAudio ? (
                  <>
                    <Button
                      disabled={batchSelecting || busy || files.length === 0}
                      onClick={() => setBatchSelecting(true)}
                    >
                      {batchSelecting ? t("批量操作中") : t("批量操作")}
                    </Button>
                    <Button
                      disabled={busy || batchSelecting}
                      icon={<IconPlus />}
                      loading={uploading}
                      onClick={() => inputRef.current?.click()}
                      type="primary"
                    >
                      {t("添加{materialName}", { materialName })}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      disabled={batchSelecting || busy || files.length === 0}
                      onClick={() => setBatchSelecting(true)}
                    >
                      {batchSelecting ? t("批量操作中") : t("批量操作")}
                    </Button>
                    <Dropdown
                      disabled={busy || batchSelecting}
                      droplist={
                        <Menu
                          onClickMenuItem={(key) => {
                            if (key === "upload") inputRef.current?.click();
                            else if (key === "create") openCreate();
                          }}
                        >
                          <Menu.Item key="upload">{t("本地上传")}</Menu.Item>
                          <Menu.Item key="create">{t("新建")}</Menu.Item>
                        </Menu>
                      }
                      position="bl"
                      trigger="click"
                      triggerProps={{
                        autoAlignPopupWidth: true,
                        style: { zIndex: RESOURCE_ASSETS_POPUP_Z_INDEX },
                      }}
                    >
                      <Button disabled={busy || batchSelecting} icon={<IconPlus />} loading={uploading} type="primary">
                        {t("添加{materialName}", { materialName })}
                      </Button>
                    </Dropdown>
                  </>
                )}
                <Button
                  aria-label={t("刷新资产")}
                  data-ea="asset-material-list-refresh"
                  disabled={batchSelecting || busy}
                  icon={
                    <span className={loading ? "animate-spin" : ""}>
                      <IconRefresh />
                    </span>
                  }
                  onClick={() => void load()}
                  title={t("刷新资产")}
                />
              </div>
            </div>
            <input
              accept={
                getResourceFileConfig(currentResource?.Type ?? item?.Type ?? resource.ResourceType.CHARACTER).accept
              }
              className="hidden"
              onChange={async (event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) await uploadFile(file);
              }}
              ref={inputRef}
              type="file"
            />
            {/* 共享音频元素：一次只播一个，播放终态统一由它驱动。 */}
            <AudioPlayer
              controls={false}
              crossOrigin="anonymous"
              onEnded={() => setPlayingId("")}
              onPause={() => setPlayingId("")}
              ref={audioRef}
              style={{ display: "none" }}
            />

            {error ? (
              <Result
                extra={<Button onClick={() => void load()}>{t("重新加载")}</Button>}
                status="error"
                title={error}
              />
            ) : loading ? (
              <div className="flex h-[240px] items-center justify-center">
                <Spin />
              </div>
            ) : files.length && visibleFiles.length ? (
              <div
                className={`grid min-h-0 flex-1 auto-rows-max content-start items-start overflow-y-auto ${styles.cardGrid}`}
              >
                {visibleFiles.map((file) => (
                  <ResourceAssetCard
                    key={file.ResourceAssetID}
                    file={file}
                    state={{
                      batchSelecting,
                      busy,
                      isAudio,
                      isOfficial,
                      materialName,
                      resourceType,
                      selected: selectedFileIds.has(file.ResourceAssetID),
                      generating: generatingFileIds.has(file.ResourceAssetID),
                      generationFailed: generationFailures.has(file.ResourceAssetID),
                      playing: playingId === file.ResourceAssetID,
                      audioSpectrum,
                    }}
                    rename={{
                      renaming: renamingId === file.ResourceAssetID,
                      renameValue,
                      renameInputRef,
                      setRenameValue,
                      cancelRename: () => setRenamingId(""),
                      saveRename,
                      startRename,
                    }}
                    actions={{
                      openMaterialEditor,
                      toggleFile,
                      stopGeneration,
                      setAsPrimary,
                      toggleAudioPlayback,
                      openReview,
                      confirmRemove,
                      downloadAsset,
                    }}
                  />
                ))}
              </div>
            ) : debouncedKeyword.trim() ? (
              <Result
                status="404"
                title={`${t("没有找到相关{materialName}", { materialName })}`}
                subTitle={t("请尝试其他关键词")}
              />
            ) : (
              <section className="mt-[110px] flex flex-col items-center gap-[10px]">
                <img
                  alt={t("暂无{type}", { type: emptyMaterialType })}
                  className="h-[320px] w-[320px] object-contain"
                  src={emptyIllustration}
                />
                <p className="m-0 text-[20px] font-medium leading-8 text-foreground">
                  {t("暂无{type}，快去添加", { type: emptyMaterialType })}
                </p>
              </section>
            )}
            {shouldHideResourcePagination(total, pageSize) ? null : (
              <div className="flex flex-none justify-end pt-6">
                <Pagination
                  current={pageNum}
                  disabled={batchSelecting}
                  onChange={(nextPage, nextPageSize) => {
                    const normalizedPageSize = normalizeResourcePageSize(nextPageSize || pageSize);
                    setPageSize(normalizedPageSize);
                    setPageNum(normalizedPageSize === pageSize ? nextPage : 1);
                  }}
                  pageSize={pageSize}
                  showTotal
                  sizeCanChange
                  sizeOptions={[...RESOURCE_PAGE_SIZE_OPTIONS]}
                  total={total}
                />
              </div>
            )}
          </>
        </div>
      </section>
      {detailFile ? (
        <ResourceAssetDetailModal
          asset={detailFile}
          busy={busy}
          materialName={materialName}
          resourceType={resourceType ?? resource.ResourceType.CHARACTER}
          zIndex={RESOURCE_ASSET_DETAIL_MODAL_Z_INDEX}
          onClose={backToList}
          onDownload={() => downloadAsset(detailFile)}
          onRename={
            isOfficial
              ? undefined
              : (name) =>
                  mutate((resourceId, revision) =>
                    renameResourceFile(agentframeService, projectId, resourceId, detailFile, revision, name),
                  )
          }
          onReplace={
            isOfficial
              ? undefined
              : async (file) => {
                  const validationError = validateResourceFile(resource.ResourceType.CHARACTER, file);
                  if (validationError) {
                    Message.error(validationError);
                    return;
                  }
                  setUploading(true);
                  await mutate(async (resourceId, revision) => {
                    const blobId = await uploadResource(file);
                    await replaceUploadedResourceAsset(agentframeService, projectId, resourceId, detailFile, revision, {
                      blobId,
                      fileName: file.name,
                    });
                  });
                  setUploading(false);
                }
          }
          onReview={isOfficial ? undefined : () => setReviewFiles([detailFile])}
          onSetPrimary={
            isOfficial
              ? undefined
              : () =>
                  mutate((resourceId, revision) =>
                    setPrimaryResourceFile(
                      agentframeService,
                      projectId,
                      resourceId,
                      detailFile.ResourceAssetID,
                      revision,
                    ),
                  )
          }
        />
      ) : null}
      {createdSlot ? (
        <ResourceAssetCreateView
          slot={createdSlot}
          busy={busy}
          projectId={projectId}
          resourceId={(currentResource ?? item)?.ResourceID ?? ""}
          resourceType={resourceType ?? resource.ResourceType.CHARACTER}
          materialName={materialName}
          onBack={backToList}
          onDownload={() => downloadAsset(createdSlot)}
          onGenerated={() => {
            void load(false);
            onChange();
          }}
          onGeneratingChange={(activeTaskRunId) => {
            updateGenerationRun(createdSlot.ResourceAssetID, activeTaskRunId);
            if (activeTaskRunId) {
              setSelectedFileIds((current) => {
                const next = new Set(current);
                next.delete(createdSlot.ResourceAssetID);
                return next;
              });
            }
          }}
          onRename={
            isOfficial
              ? undefined
              : (name) =>
                  mutate((resourceId, revision) =>
                    renameResourceFile(agentframeService, projectId, resourceId, createdSlot, revision, name),
                  )
          }
          onReview={() => setReviewFiles([createdSlot])}
          onSetPrimary={() =>
            mutate((resourceId, revision) =>
              setPrimaryResourceFile(agentframeService, projectId, resourceId, createdSlot.ResourceAssetID, revision),
            )
          }
        />
      ) : null}
      {reviewFiles.some((file) => file.CurrentAssetID) ? (
        <AssetReviewModal
          items={reviewFiles.flatMap((file) =>
            file.CurrentAssetID
              ? [
                  {
                    assetId: file.CurrentAssetID,
                    review: latestAssetReview(file.Reviews),
                  },
                ]
              : [],
          )}
          materialName={isCharacter ? t("形象素材") : t("音频素材")}
          onClose={() => setReviewFiles([])}
          onSuccess={async () => {
            setReviewFiles([]);
            setSelectedFileIds(new Set());
            setBatchSelecting(false);
            await load(false);
          }}
          projectId={projectId}
          visible
          zIndex={RESOURCE_ASSET_DETAIL_MODAL_Z_INDEX}
        />
      ) : null}
      {batchSelecting ? (
        <BatchActionBar
          busy={busy}
          pageItemCount={visibleFiles.length}
          reviewDisabled={!selectedFiles.some((file) => file.CurrentAssetID)}
          selectedCount={selectedFiles.length}
          onClose={() => {
            setSelectedFileIds(new Set());
            setBatchSelecting(false);
          }}
          onDelete={confirmBatchRemove}
          onReview={() => setReviewFiles(selectedFiles.filter((file) => file.CurrentAssetID))}
          onSelectPage={(selected) =>
            setSelectedFileIds(selected ? new Set(visibleFiles.map((file) => file.ResourceAssetID)) : new Set())
          }
        />
      ) : null}
    </main>
  );
}
