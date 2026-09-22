import {
  RefreshCw as IconRefresh,
  ImageOff as IconBlankAssets,
  Upload as IconLocalAddition,
  Plus as IconPlus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import emptyIllustration from "@/assets/storyboard-empty.png";
import { AudioPlayer } from "@/components/audioPlayer/index";
import { useAudioSpectrum } from "@/components/AudioSpectrum/index";
import { Pagination, Result, openDeleteConfirmModal } from "@/components/compat";
import { Dropdown, Message, Spin, Menu, Button } from "@/components/ui";
import { resource } from "@/domain";
import { resolveArtifactURL } from "@/utils/artifactURL";
import { downloadWithFetch } from "@/utils/download";
import t from "@/utils/i18n";

import { FilterTabs } from "../../components/FilterTabs";
import { SearchInput } from "../../components/SearchInput";
import { useProjectLayoutSummary } from "../projectLayout/index";
import { ResourceAssetsModal } from "./assets/ResourceAssetsModal";
import { useResourceUpload } from "./assets/useResourceUpload";
import { BatchActionBar } from "./components/BatchActionBar";
import { ResourceTypeIcon } from "./components/ResourceTypeIcon";
import { ResourceDialog } from "./dialogs/ResourceDialog";
import { ResourceReviewModal } from "./dialogs/ResourceReviewModal";
import {
  addResourceFile,
  batchDeleteResources,
  createResource,
  deleteResource,
  listResourceFiles,
  replaceUploadedResourceAsset,
} from "./domain/actions";
import {
  RESOURCE_PAGE_SIZE_OPTIONS,
  normalizeResourcePageSize,
  shouldHideResourcePagination,
} from "./domain/paginationRules";
import {
  RESOURCE_TYPE_OPTIONS,
  getResourceFileConfig,
  getResourceNameFromFile,
  validateResourceFile,
} from "./domain/resourceTypes";
import { writeResourceListRouteState } from "./domain/routeState";
import { ResourceCard } from "./list/ResourceCard";
import { useResourceList } from "./list/useResourceList";

import styles from "./index.module.less";

type DialogState = { mode: "create"; type: resource.ResourceType } | { mode: "edit"; item: resource.Resource };

function getResourceTypeCount(stats: resource.ProjectResourceStats, type: resource.ResourceType) {
  switch (type) {
    case resource.ResourceType.CHARACTER:
      return stats.CharacterCount;
    case resource.ResourceType.SCENE:
      return stats.SceneCount;
    case resource.ResourceType.PROP:
      return stats.PropCount;
    case resource.ResourceType.AUDIO:
      return stats.AudioCount;
  }
}

export default function ResourcesPage() {
  const { projectId = "" } = useParams();
  const {
    pageNum,
    pageSize,
    selectedType,
    setSearchParams,
    keyword,
    setKeyword,
    refresh,
    resourceStats,
    items,
    total,
    loading,
    error,
    isSearching,
    searchResultCountReady,
    debouncedKeyword,
  } = useResourceList(projectId);
  const uploadResource = useResourceUpload();
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const audioUploadInputRef = useRef<HTMLInputElement>(null);
  const audioUploadTargetRef = useRef<resource.Resource>();
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioSpectrum = useAudioSpectrum(audioRef);
  const activeAudioResourceIdRef = useRef("");
  const [playingAudioResourceId, setPlayingAudioResourceId] = useState("");
  const [creatingFromFiles, setCreatingFromFiles] = useState(false);
  const [pendingAudioResourceId, setPendingAudioResourceId] = useState("");
  const [dialogState, setDialogState] = useState<DialogState>();
  const [managedResource, setManagedResource] = useState<resource.Resource>();
  const [reviewItems, setReviewItems] = useState<resource.Resource[]>([]);
  const [batchSelecting, setBatchSelecting] = useState(false);
  const [selectedResourceIds, setSelectedResourceIds] = useState<Set<string>>(new Set());
  const selectedTypeLabel = RESOURCE_TYPE_OPTIONS.find((option) => option.value === selectedType)?.label ?? t("资产");

  const toggleAudioPlayback = (item: resource.Resource) => {
    const element = audioRef.current;
    const previewURL = item.PrimaryResourceAsset?.PreviewURL;
    const audioURL = previewURL ? resolveArtifactURL(previewURL) : undefined;
    if (!element || !audioURL) return;
    if (activeAudioResourceIdRef.current === item.ResourceID && playingAudioResourceId === item.ResourceID) {
      element.pause();
      setPlayingAudioResourceId("");
      return;
    }
    if (activeAudioResourceIdRef.current !== item.ResourceID) {
      if (activeAudioResourceIdRef.current) element.pause();
      element.src = audioURL;
      element.currentTime = 0;
      activeAudioResourceIdRef.current = item.ResourceID;
    }
    void audioSpectrum.prepare();
    void element
      .play()
      .then(() => setPlayingAudioResourceId(item.ResourceID))
      .catch(() => setPlayingAudioResourceId(""));
  };

  useEffect(() => {
    setBatchSelecting(false);
    setSelectedResourceIds(new Set());
  }, [selectedType]);

  useEffect(() => {
    if (playingAudioResourceId && !items.some((item) => item.ResourceID === playingAudioResourceId)) {
      audioRef.current?.pause();
      activeAudioResourceIdRef.current = "";
      setPlayingAudioResourceId("");
    }
  }, [items, playingAudioResourceId]);

  useEffect(
    () => () => {
      audioRef.current?.pause();
    },
    [],
  );
  const selectedResources = items.filter((item) => selectedResourceIds.has(item.ResourceID));
  const selectableItems = items.filter((item) => item.OwnerType !== resource.ResourceOwnerType.OFFICIAL);
  useProjectLayoutSummary(`${t("共 {total} 资产", { total })}`);

  const toggleResource = (resourceId: string) => {
    setSelectedResourceIds((current) => {
      const next = new Set(current);
      if (next.has(resourceId)) next.delete(resourceId);
      else next.add(resourceId);
      return next;
    });
  };

  const finishReview = () => {
    setBatchSelecting(false);
    setSelectedResourceIds(new Set());
    refresh();
  };

  const createFromLocalFiles = async (files: File[]) => {
    if (!files.length || creatingFromFiles) return;
    setCreatingFromFiles(true);
    let createdCount = 0;
    let failedCount = 0;
    for (const file of files) {
      const validationError = validateResourceFile(selectedType, file);
      if (validationError) {
        failedCount += 1;
        Message.error(`${file.name}：${validationError}`);
        continue;
      }
      try {
        const blobId = await uploadResource(file);
        const name = getResourceNameFromFile(file.name);
        await createResource(projectId, {
          name,
          type: selectedType,
          files: [{ blobId, fileName: file.name, name }],
        });
        createdCount += 1;
      } catch {
        failedCount += 1;
      }
    }
    if (createdCount) {
      refresh();
      Message.success(t("成功创建 {count} 个资产", { count: createdCount }));
    }
    if (failedCount) {
      Message.error(t("{count} 个文件创建失败", { count: failedCount }));
    }
    setCreatingFromFiles(false);
    if (uploadInputRef.current) uploadInputRef.current.value = "";
  };

  const chooseAudioFile = (item: resource.Resource) => {
    if (pendingAudioResourceId) return;
    audioUploadTargetRef.current = item;
    if (audioUploadInputRef.current) {
      audioUploadInputRef.current.value = "";
      audioUploadInputRef.current.click();
    }
  };

  const uploadOrReplaceAudio = async (file?: File) => {
    const item = audioUploadTargetRef.current;
    if (!file || !item || pendingAudioResourceId) return;
    const validationError = validateResourceFile(resource.ResourceType.AUDIO, file);
    if (validationError) {
      Message.error(`${file.name}：${validationError}`);
      audioUploadTargetRef.current = undefined;
      if (audioUploadInputRef.current) audioUploadInputRef.current.value = "";
      return;
    }
    setPendingAudioResourceId(item.ResourceID);
    try {
      const primary = item.PrimaryResourceAsset
        ? (await listResourceFiles(projectId, item.ResourceID)).find(
            (resourceAsset) => resourceAsset.ResourceAssetID === item.PrimaryResourceAsset?.ResourceAssetID,
          )
        : undefined;
      if (item.PrimaryResourceAsset && !primary) {
        throw new Error("Primary audio asset not found");
      }
      const blobId = await uploadResource(file);
      if (primary) {
        await replaceUploadedResourceAsset(projectId, item.ResourceID, primary, item.Revision, {
          blobId,
          fileName: file.name,
        });
        Message.success(t("音频替换成功"));
      } else {
        await addResourceFile(projectId, item.ResourceID, item.Revision, {
          blobId,
          fileName: file.name,
          name: getResourceNameFromFile(file.name),
        });
        Message.success(t("音频上传成功"));
      }
      refresh();
    } catch {
      Message.error(item.PrimaryResourceAsset ? t("音频替换失败") : t("音频上传失败"));
    } finally {
      setPendingAudioResourceId("");
      audioUploadTargetRef.current = undefined;
      if (audioUploadInputRef.current) audioUploadInputRef.current.value = "";
    }
  };

  const downloadAudio = (item: resource.Resource) => {
    const primary = item.PrimaryResourceAsset;
    if (!primary?.PreviewURL) return;
    const audioURL = resolveArtifactURL(primary.PreviewURL);
    if (!audioURL) return;
    void downloadWithFetch({
      name: primary.Name || item.Name || "download",
      url: audioURL,
    });
  };

  const confirmDelete = (item: resource.Resource) => {
    openDeleteConfirmModal({
      name: t("资产"),
      targetName: item.Name,
      info: (
        <span className="block px-6">
          {t("删除后，分镜中引用字段将失效，已提交的合规审核素材将从权益账号中一并删除。此操作不可撤销，请谨慎操作。")}
        </span>
      ),
      className: "w-[400px]! max-w-[calc(100vw-48px)]!",
      async onOk() {
        try {
          await deleteResource(projectId, item.ResourceID, item.Revision);
        } finally {
          refresh();
        }
      },
    });
  };

  const confirmBatchDelete = () => {
    if (!selectedResources.length) return;
    const count = selectedResources.length;
    openDeleteConfirmModal({
      name: t("{count} 个资产", { count }),
      targetName: t("确定删除{count}个资产", { count }),
      targetNameLabel: t("请输入："),
      confirmPlaceholder: t("请输入提示，以确认删除"),
      info: (
        <span className="block px-6">
          {t("删除后，分镜中引用字段将失效，已提交的合规审核素材将从权益账号中一并删除。此操作不可撤销，请谨慎操作。")}
        </span>
      ),
      className: "w-[400px]! max-w-[calc(100vw-48px)]!",
      async onOk() {
        try {
          await batchDeleteResources(projectId, selectedResources);
        } finally {
          setBatchSelecting(false);
          setSelectedResourceIds(new Set());
          refresh();
        }
      },
    });
  };

  return (
    <section
      aria-label={t("资产库列表页")}
      className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-5 pb-5 pt-3"
    >
      <div
        aria-label={t("资产列表工具栏")}
        className="mb-6 flex flex-none flex-wrap items-center justify-between gap-3"
        role="toolbar"
      >
        <div className="flex flex-wrap items-center gap-2">
          <FilterTabs
            ariaLabel={t("资产类型")}
            disabled={batchSelecting}
            onChange={(nextType) => {
              setSearchParams((current) =>
                writeResourceListRouteState(current, {
                  page: 1,
                  type: nextType,
                }),
              );
            }}
            options={RESOURCE_TYPE_OPTIONS.map((option) => ({
              label: (
                <>
                  <span className="inline-flex text-[16px]">
                    <ResourceTypeIcon type={option.value} />
                  </span>
                  {option.label}
                  {isSearching ? (
                    option.value === selectedType && searchResultCountReady ? (
                      <span aria-hidden="true" className={styles.filterTabCount}>
                        {total}
                      </span>
                    ) : null
                  ) : resourceStats ? (
                    <span aria-hidden="true" className={styles.filterTabCount}>
                      {getResourceTypeCount(resourceStats, option.value)}
                    </span>
                  ) : null}
                </>
              ),
              value: option.value,
            }))}
            value={selectedType}
          />
          <SearchInput
            className={styles.searchInput}
            disabled={batchSelecting}
            onChange={(value) => {
              setKeyword(value);
              if (pageNum !== 1) {
                setSearchParams((current) => writeResourceListRouteState(current, { page: 1 }), { replace: true });
              }
            }}
            placeholder={t("输入资产名称搜索")}
            value={keyword}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button disabled={batchSelecting || !selectableItems.length} onClick={() => setBatchSelecting(true)}>
            {batchSelecting ? t("批量操作中") : t("批量操作")}
          </Button>
          <Dropdown
            disabled={batchSelecting}
            droplist={
              <Menu
                onClickMenuItem={(key) => {
                  if (key === "upload") uploadInputRef.current?.click();
                  else setDialogState({ mode: "create", type: selectedType });
                }}
              >
                <Menu.Item key="upload">
                  <span className="flex items-center gap-[6px]">
                    <IconLocalAddition style={{ height: 16, width: 16 }} />
                    {t("从本地上传")}
                  </span>
                </Menu.Item>
                <Menu.Item key="blank">
                  <span className="flex items-center gap-[6px]">
                    <IconBlankAssets style={{ height: 16, width: 16 }} />
                    {t("新建空白资产")}
                  </span>
                </Menu.Item>
              </Menu>
            }
            position="bl"
            trigger="click"
          >
            <Button disabled={batchSelecting} icon={<IconPlus />} loading={creatingFromFiles} type="primary">
              {t("创建资产")}
            </Button>
          </Dropdown>
          <Button
            aria-label={t("刷新资产库")}
            data-ea="asset-library-list-refresh"
            icon={
              <span className={loading ? "animate-spin" : ""}>
                <IconRefresh />
              </span>
            }
            onClick={refresh}
            title={t("刷新资产库")}
          />
        </div>
      </div>
      <input
        ref={uploadInputRef}
        accept={getResourceFileConfig(selectedType).accept}
        aria-label={t("从本地上传")}
        className="hidden"
        multiple
        onChange={(event) => {
          void createFromLocalFiles(Array.from(event.target.files ?? []));
        }}
        type="file"
      />
      <input
        ref={audioUploadInputRef}
        accept={getResourceFileConfig(resource.ResourceType.AUDIO).accept}
        aria-label={t("上传或替换音频")}
        className="hidden"
        onChange={(event) => {
          void uploadOrReplaceAudio(event.target.files?.[0]);
        }}
        type="file"
      />
      <AudioPlayer
        controls={false}
        crossOrigin="anonymous"
        onEnded={(event) => {
          event.currentTarget.currentTime = 0;
          setPlayingAudioResourceId("");
        }}
        onPause={() => setPlayingAudioResourceId("")}
        ref={audioRef}
        style={{ display: "none" }}
      />

      <div aria-label={t("资产列表内容")} className="min-h-0 flex-1 overflow-y-auto" role="region">
        {loading ? (
          <div className="flex h-full min-h-[320px] items-center justify-center">
            <Spin />
          </div>
        ) : error && !items.length ? (
          <Result
            extra={<Button onClick={refresh}>{t("重新加载")}</Button>}
            status="error"
            title={t("资产加载失败")}
            subTitle={t("请稍后重试")}
          />
        ) : items.length ? (
          <div className={`grid grid-cols-5 ${styles.cardGrid}`}>
            {items.map((item) => (
              <ResourceCard
                item={item}
                key={item.ResourceID}
                audioPending={pendingAudioResourceId === item.ResourceID}
                onDelete={() => confirmDelete(item)}
                onDownloadAudio={() => downloadAudio(item)}
                onEdit={() => setDialogState({ mode: "edit", item })}
                onManage={() => setManagedResource(item)}
                onReview={() => setReviewItems([item])}
                onChooseAudio={() => chooseAudioFile(item)}
                onSelect={() => toggleResource(item.ResourceID)}
                selectable={item.OwnerType !== resource.ResourceOwnerType.OFFICIAL}
                selected={selectedResourceIds.has(item.ResourceID)}
                selecting={batchSelecting}
                playing={playingAudioResourceId === item.ResourceID}
                spectrumFallback={audioSpectrum.fallback}
                spectrumHeights={audioSpectrum.heights}
                onToggleAudio={() => toggleAudioPlayback(item)}
              />
            ))}
          </div>
        ) : debouncedKeyword.trim() ? (
          <Result status="404" title={t("没有找到相关资产")} subTitle={t("请尝试其他关键词")} />
        ) : (
          <section className="mt-[110px] flex flex-col items-center gap-[10px]">
            <img
              alt={t("暂无{type}资产", { type: selectedTypeLabel })}
              className="h-[320px] w-[320px] object-contain"
              src={emptyIllustration}
            />
            <p className="m-0 text-[20px] font-medium leading-8 text-foreground">
              {t("暂无{type}资产，快去添加", { type: selectedTypeLabel })}
            </p>
          </section>
        )}
      </div>
      {shouldHideResourcePagination(total, pageSize) ? null : (
        <footer aria-label={t("资产列表分页")} className="flex flex-none justify-end pt-6">
          <Pagination
            current={pageNum}
            disabled={batchSelecting}
            onChange={(nextPage, nextPageSize) => {
              const normalizedPageSize = normalizeResourcePageSize(nextPageSize || pageSize);
              setSearchParams((current) =>
                writeResourceListRouteState(current, {
                  page: normalizedPageSize === pageSize ? nextPage : 1,
                  pageSize: normalizedPageSize,
                }),
              );
              setSelectedResourceIds(new Set());
            }}
            pageSize={pageSize}
            showTotal
            sizeCanChange
            sizeOptions={[...RESOURCE_PAGE_SIZE_OPTIONS]}
            total={total}
          />
        </footer>
      )}
      {batchSelecting ? (
        <BatchActionBar
          pageItemCount={selectableItems.length}
          selectedCount={selectedResources.length}
          onClose={() => {
            setBatchSelecting(false);
            setSelectedResourceIds(new Set());
          }}
          onDelete={confirmBatchDelete}
          onReview={() => setReviewItems(selectedResources)}
          onSelectPage={(selected) =>
            setSelectedResourceIds(selected ? new Set(selectableItems.map((item) => item.ResourceID)) : new Set())
          }
        />
      ) : null}
      <ResourceDialog
        projectId={projectId}
        state={dialogState}
        onClose={() => setDialogState(undefined)}
        onSuccess={refresh}
      />
      <ResourceReviewModal
        items={reviewItems}
        projectId={projectId}
        onClose={() => setReviewItems([])}
        onSuccess={finishReview}
      />
      {managedResource ? (
        <ResourceAssetsModal
          item={managedResource}
          onChange={refresh}
          onClose={() => setManagedResource(undefined)}
          projectId={projectId}
        />
      ) : null}
    </section>
  );
}
