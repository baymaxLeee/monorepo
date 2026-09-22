import {
  Library as IconAssetLibrary,
  FolderOpen as IconFolderAssetLibrary,
  ImagePlus as IconGenerationImage,
  Video as IconGenerationVideo,
  LocateFixed as IconLocationNode,
  Music as IconMusic,
  Image as IconPic,
  Play as IconPlay,
  Plus as IconPluginListedAdd,
  Video as IconVideoDefault,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import groupDownIcon from "@/assets/canvas/group-down.svg";
import groupPlusIcon from "@/assets/canvas/group-plus.svg";
import { Collapse } from "@/components/Collapse";
import { AssetPreviewCard } from "@/components/promptEditor/plugins/assetMention/AssetPreviewCard";
import { splitHighlight } from "@/components/promptEditor/plugins/assetMention/mentionTree";
import { AssetReviewMark } from "@/components/promptEditor/plugins/assetMention/ReviewStatus";
import type { AssetMentionItem } from "@/components/promptEditor/plugins/assetMention/types";
import { SearchInput } from "@/components/SearchInput";
import { Dropdown, Menu, Spin, Trigger } from "@/components/ui";
import { asset as assetIDL, canvasnode, resource } from "@/domain";
import { resolveArtifactURL } from "@/utils/artifactURL";
import { latestAssetReview } from "@/utils/assetReview";
import t from "@/utils/i18n";

import { ResourceAssetsModal } from "../../resources/assets/ResourceAssetsModal";
import type { ResourceAssetsInitialAction } from "../../resources/assets/ResourceAssetsPage";
import { ResourceTypeIcon } from "../../resources/components/ResourceTypeIcon";
import { ResourceDialog } from "../../resources/dialogs/ResourceDialog";
import { listResourceFiles, listResources } from "../../resources/domain/actions";
import { getResourceFileConfig } from "../../resources/domain/resourceTypes";

import styles from "./StudioAssetPanel.module.less";

const RESOURCE_TYPES = [
  {
    label: t("角色"),
    value: resource.ResourceType.CHARACTER,
  },
  {
    label: t("场景"),
    value: resource.ResourceType.SCENE,
  },
  {
    label: t("道具"),
    value: resource.ResourceType.PROP,
  },
  {
    label: t("音频"),
    value: resource.ResourceType.AUDIO,
  },
] as const;

const RESOURCE_TYPE_BY_NAME: Record<NonNullable<AssetMentionItem["resourceType"]>, resource.ResourceType> = {
  character: resource.ResourceType.CHARACTER,
  scene: resource.ResourceType.SCENE,
  prop: resource.ResourceType.PROP,
  audio: resource.ResourceType.AUDIO,
};

export const CANVAS_ASSET_DRAG_TYPE = "application/x-canvas-canvas-asset";

export type CanvasAssetDragData = {
  resourceAssetId?: string;
  resourceId?: string;
  nodeType: canvasnode.CanvasNodeType;
  previewURL?: string;
};

export type CanvasPanelNode = {
  asset: AssetMentionItem;
  item: canvasnode.CanvasNode;
  previewURL?: string;
};

type ResourceAssetsActionInput = { type: "create" } | { file: File; type: "upload" };

const NODE_KIND: Record<number, { icon: string; label: string }> = {
  [canvasnode.CanvasNodeType.IMAGE_ASSET]: { icon: "图", label: t("图片") },
  [canvasnode.CanvasNodeType.VIDEO_ASSET]: { icon: "视", label: t("视频") },
  [canvasnode.CanvasNodeType.AUDIO_ASSET]: { icon: "音", label: t("音频") },
  [canvasnode.CanvasNodeType.TEXT]: { icon: "T", label: t("文本") },
  [canvasnode.CanvasNodeType.IMAGE_GENERATION]: {
    icon: "图",
    label: t("图片生成"),
  },
  [canvasnode.CanvasNodeType.VIDEO_GENERATION]: {
    icon: "视",
    label: t("视频生成"),
  },
  [canvasnode.CanvasNodeType.TEXT_GENERATION]: {
    icon: "文",
    label: t("文本生成"),
  },
  [canvasnode.CanvasNodeType.STORYBOARD_DRAFT]: {
    icon: "镜",
    label: t("批量分镜"),
  },
};

function HighlightedName({ query, text }: { query: string; text: string }) {
  let offset = 0;
  return (
    <>
      {splitHighlight(text, query).map((part) => {
        const start = offset;
        offset += part.text.length;
        return part.match ? (
          <mark className={styles.searchHighlight} key={`${start}-${offset}-${part.text}`}>
            {part.text}
          </mark>
        ) : (
          <span key={`${start}-${offset}-${part.text}`}>{part.text}</span>
        );
      })}
    </>
  );
}

function CanvasNodeThumbnail({
  asset,
  fallback,
  item,
  previewURL,
}: {
  asset: Pick<AssetMentionItem, "referenceType" | "resourceType">;
  fallback: string;
  item: canvasnode.CanvasNode;
  previewURL?: string;
}) {
  const imageAsset = item.Type === canvasnode.CanvasNodeType.IMAGE_ASSET;
  const videoAsset = item.Type === canvasnode.CanvasNodeType.VIDEO_ASSET;
  const audioAsset = item.Type === canvasnode.CanvasNodeType.AUDIO_ASSET;
  const imageGeneration = item.Type === canvasnode.CanvasNodeType.IMAGE_GENERATION;
  const videoGeneration = item.Type === canvasnode.CanvasNodeType.VIDEO_GENERATION;
  const videoNode = videoAsset || videoGeneration;
  const resourceType =
    asset.referenceType === "resource" && asset.resourceType ? RESOURCE_TYPE_BY_NAME[asset.resourceType] : undefined;
  const [loadFailed, setLoadFailed] = useState(false);
  const hasPreview = Boolean(previewURL && !loadFailed && !audioAsset);

  useEffect(() => setLoadFailed(false), [previewURL]);

  return (
    <span className={styles.nodeThumbnail}>
      {hasPreview ? (
        videoAsset ? (
          <video
            aria-hidden
            muted
            onError={() => setLoadFailed(true)}
            playsInline
            preload="metadata"
            src={previewURL}
          />
        ) : (
          <img alt="" onError={() => setLoadFailed(true)} src={previewURL} />
        )
      ) : resourceType !== undefined ? (
        <ResourceTypeIcon type={resourceType} />
      ) : imageGeneration ? (
        <IconGenerationImage />
      ) : videoGeneration ? (
        <IconGenerationVideo />
      ) : imageAsset ? (
        <IconPic />
      ) : videoAsset ? (
        <IconVideoDefault />
      ) : audioAsset ? (
        <IconMusic />
      ) : (
        <span>{fallback}</span>
      )}
      {videoNode && hasPreview ? (
        <span aria-label={t("视频")} className={styles.nodeVideoPlay}>
          <IconPlay />
        </span>
      ) : null}
    </span>
  );
}

function nodeTypeForResource(type: resource.ResourceType) {
  return type === resource.ResourceType.AUDIO
    ? canvasnode.CanvasNodeType.AUDIO_ASSET
    : canvasnode.CanvasNodeType.IMAGE_ASSET;
}

function categoryForMediaType(mediaType: assetIDL.AssetMediaType): AssetMentionItem["category"] {
  if (mediaType === assetIDL.AssetMediaType.VIDEO) return "video";
  if (mediaType === assetIDL.AssetMediaType.AUDIO) return "audio";
  return "image";
}

function previewAssetForResource(item: resource.Resource): AssetMentionItem {
  const primary = item.PrimaryResourceAsset;
  const category = primary
    ? categoryForMediaType(primary.MediaType)
    : item.Type === resource.ResourceType.AUDIO
      ? "audio"
      : "image";
  const previewUrl = resolveArtifactURL(primary?.PreviewURL ?? "");
  return {
    assetId: primary?.CurrentAssetID,
    category,
    description: item.Description,
    id: primary?.CurrentAssetID ?? item.ResourceID,
    previewUrl,
    resourceAssetId: primary?.ResourceAssetID,
    resourceId: item.ResourceID,
    review: latestAssetReview(primary?.Reviews),
    reviews: primary?.Reviews,
    source: "project",
    thumbnail: category === "image" ? previewUrl : undefined,
    title: item.Name,
  };
}

function ReviewBadge({ asset }: { asset: AssetMentionItem }) {
  return asset.review ? (
    <span className={styles.statusBadge}>
      <AssetReviewMark asset={asset} />
    </span>
  ) : null;
}

function AssetStatusBadge({ asset, isPrimary }: { asset: AssetMentionItem; isPrimary: boolean }) {
  return isPrimary ? (
    <span aria-label={t("主形象")} className={`${styles.statusBadge} ${styles.primaryBadge}`}>
      {t("主")}
    </span>
  ) : (
    <ReviewBadge asset={asset} />
  );
}

function PreviewTrigger({
  asset,
  children,
  label,
  onReview,
  onVisibleChange,
  showReviewStatus = true,
  visible,
}: {
  asset: AssetMentionItem;
  children: React.ReactNode;
  label?: string;
  onReview?: (asset: AssetMentionItem) => void;
  onVisibleChange: (visible: boolean) => void;
  showReviewStatus?: boolean;
  visible: boolean;
}) {
  return (
    <Trigger
      mouseEnterDelay={100}
      mouseLeaveDelay={100}
      onVisibleChange={onVisibleChange}
      popup={() => (
        <div aria-label={label ?? t("预览：{name}", { name: asset.title })}>
          <AssetPreviewCard
            asset={asset}
            onSubmitReview={onReview && asset.assetId ? onReview : undefined}
            showReviewStatus={showReviewStatus}
          />
        </div>
      )}
      popupHoverStay
      popupVisible={visible}
      position="right"
      trigger="hover"
    >
      {children}
    </Trigger>
  );
}

export function StudioAssetPanel({
  canvasNodes = [],
  onLocateNode,
  onReview,
  projectId,
}: {
  canvasNodes?: CanvasPanelNode[];
  onLocateNode?: (nodeId: string) => void;
  onReview?: (asset: AssetMentionItem, onUpdated: (review: assetIDL.AssetReview) => void) => void;
  projectId: string;
}) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"nodes" | "assets">("assets");
  const [selectedType, setSelectedType] = useState<resource.ResourceType>(resource.ResourceType.CHARACTER);
  const [keyword, setKeyword] = useState("");
  const [items, setItems] = useState<resource.Resource[]>([]);
  const [resourceAssets, setResourceAssets] = useState<Map<string, resource.ResourceAsset[]>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [dialogType, setDialogType] = useState<resource.ResourceType>();
  const [resourceModalState, setResourceModalState] = useState<{
    initialAction?: ResourceAssetsInitialAction;
    item: resource.Resource;
  }>();
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  const assetLoadScopeRef = useRef("");
  const loadingResourceAssetIdsRef = useRef(new Set<string>());
  const [hoveredPreviewId, setHoveredPreviewId] = useState("");
  const [draggingPreviewId, setDraggingPreviewId] = useState("");
  const [reviewOverrides, setReviewOverrides] = useState<Record<string, assetIDL.AssetReview>>({});

  const withLatestReview = (item: AssetMentionItem): AssetMentionItem => {
    const latest = reviewOverrides[item.assetId ?? item.id];
    return {
      ...item,
      review: latest ?? item.review,
      reviews: latest
        ? [...(item.reviews ?? []).filter((review) => review.PackageID !== latest.PackageID), latest]
        : item.reviews,
    };
  };

  const reviewAsset = onReview
    ? (item: AssetMentionItem) =>
        onReview(item, (review) => {
          setReviewOverrides((current) => ({
            ...current,
            [item.assetId ?? item.id]: review,
          }));
        })
    : undefined;
  const resourceActionIdRef = useRef(0);
  const resourceUploadInputRef = useRef<HTMLInputElement>(null);
  const resourceUploadTargetRef = useRef<resource.Resource>();

  const openResourceAction = (item: resource.Resource, action: ResourceAssetsActionInput) => {
    resourceActionIdRef.current += 1;
    setResourceModalState({
      initialAction: { ...action, id: resourceActionIdRef.current },
      item,
    });
  };

  useEffect(() => {
    if (tab !== "assets") return;
    let active = true;
    const scope = `${projectId}:${selectedType}:${reloadKey}`;
    assetLoadScopeRef.current = scope;
    loadingResourceAssetIdsRef.current.clear();
    setItems([]);
    setResourceAssets(new Map());
    setExpandedGroupIds(new Set());
    const timer = window.setTimeout(() => {
      setLoading(true);
      void (async () => {
        const pageSize = 100;
        const resources: resource.Resource[] = [];
        for (let pageNum = 1; ; pageNum += 1) {
          const result = await listResources(projectId, {
            keyword: "",
            ascending: false,
            pageNum,
            pageSize,
            type: selectedType,
          });
          resources.push(...result.items);
          if (result.items.length === 0 || resources.length >= result.total) {
            break;
          }
        }
        if (!active) return;
        setItems(resources);
      })()
        .catch(() => {
          if (active) setItems([]);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      if (assetLoadScopeRef.current === scope) {
        assetLoadScopeRef.current = "";
      }
      window.clearTimeout(timer);
    };
  }, [projectId, reloadKey, selectedType, tab]);

  useEffect(() => {
    if (tab !== "assets" || items.length === 0) return;
    const scope = assetLoadScopeRef.current;
    const targetIds = keyword.trim() ? items.map((item) => item.ResourceID) : [...expandedGroupIds];
    targetIds.forEach((resourceId) => {
      if (resourceAssets.has(resourceId) || loadingResourceAssetIdsRef.current.has(resourceId)) {
        return;
      }
      loadingResourceAssetIdsRef.current.add(resourceId);
      void listResourceFiles(projectId, resourceId)
        .then((assets) => {
          if (assetLoadScopeRef.current !== scope) return;
          setResourceAssets((current) => {
            const next = new Map(current);
            next.set(resourceId, assets);
            return next;
          });
        })
        .catch(() => {
          if (assetLoadScopeRef.current !== scope) return;
          setResourceAssets((current) => {
            const next = new Map(current);
            next.set(resourceId, []);
            return next;
          });
        })
        .finally(() => {
          if (assetLoadScopeRef.current !== scope) return;
          loadingResourceAssetIdsRef.current.delete(resourceId);
        });
    });
  }, [expandedGroupIds, items, keyword, projectId, resourceAssets, tab]);

  const groups = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase();
    return items.flatMap((item) => {
      const assets = resourceAssets.get(item.ResourceID) ?? [];
      if (!normalized || item.Name.toLocaleLowerCase().includes(normalized)) {
        return [{ item, assets }];
      }
      const matchedAssets = assets.filter((asset) => asset.Name.toLocaleLowerCase().includes(normalized));
      return matchedAssets.length > 0 ? [{ item, assets: matchedAssets }] : [];
    });
  }, [items, keyword, resourceAssets]);

  const visibleNodes = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase();
    return [...canvasNodes]
      .sort((left, right) => left.item.CreatedAt.localeCompare(right.item.CreatedAt))
      .filter(({ item }) => {
        if (!normalized) return true;
        return [item.Name, item.Text, item.Prompt].some((value) => value?.toLocaleLowerCase().includes(normalized));
      });
  }, [canvasNodes, keyword]);

  const renderResourceHeader = (item: resource.Resource) => {
    const hasCover = item.Type !== resource.ResourceType.AUDIO && Boolean(item.PrimaryResourceAsset?.PreviewURL);

    return (
      <span className={styles.groupSummary}>
        <span className={`${styles.groupThumbnail} ${hasCover ? "" : styles.fallbackThumbnail}`}>
          {hasCover ? (
            <img alt="" src={resolveArtifactURL(item.PrimaryResourceAsset?.PreviewURL ?? "")} />
          ) : (
            <ResourceTypeIcon type={item.Type} />
          )}
        </span>
        <span className={styles.groupLabel}>
          <strong className={styles.groupName} title={item.Name}>
            <HighlightedName query={keyword} text={item.Name} />
          </strong>
          <span className={styles.groupCount}>· {item.ResourceAssetCount}</span>
        </span>
      </span>
    );
  };

  return (
    <aside className={styles.panel}>
      <div className={styles.topTabs}>
        <button
          className={tab === "nodes" ? styles.activeTopTab : styles.topTab}
          onClick={() => setTab("nodes")}
          type="button"
        >
          {t("节点")}
        </button>
        <button
          className={tab === "assets" ? styles.activeTopTab : styles.topTab}
          onClick={() => setTab("assets")}
          type="button"
        >
          {t("资产")}
        </button>
        {tab === "assets" ? (
          <span className={styles.assetActions}>
            <Dropdown
              droplist={
                <Menu
                  onClickMenuItem={(key) => {
                    if (key === "create") setDialogType(selectedType);
                    else if (key === "manage") {
                      void navigate(`/platform/canvas/projects/${projectId}/resources`);
                    }
                  }}
                >
                  <Menu.Item key="create">
                    <span className={styles.assetActionItem}>
                      <IconPluginListedAdd />
                      {t("新建资产")}
                    </span>
                  </Menu.Item>
                  <Menu.Item key="manage">
                    <span className={styles.assetActionItem}>
                      <IconAssetLibrary />
                      {t("打开资产库管理")}
                    </span>
                  </Menu.Item>
                </Menu>
              }
              position="br"
              trigger="click"
            >
              <button aria-label={t("资产操作")} className={styles.assetActionsButton} type="button">
                <IconFolderAssetLibrary />
              </button>
            </Dropdown>
          </span>
        ) : null}
      </div>

      {tab === "nodes" ? (
        <div className={styles.nodeBody}>
          <div className={styles.searchContainer}>
            <SearchInput
              className={styles.search}
              onChange={setKeyword}
              placeholder={t("输入名称搜索")}
              value={keyword}
            />
          </div>
          <div className={styles.nodeList}>
            {visibleNodes.length === 0 ? (
              <div className={styles.empty}>{t("暂无画布节点")}</div>
            ) : (
              visibleNodes.map(({ asset, item, previewURL }) => {
                const kind = NODE_KIND[item.Type] ?? {
                  icon: "·",
                  label: t("节点"),
                };
                const previewAsset = withLatestReview({
                  ...asset,
                  isPrimary: item.ResourceAssetIsPrimary === true,
                });
                const previewId = `node:${item.NodeID}`;
                const name = item.Name || item.Text || item.Prompt || kind.label;
                return (
                  <PreviewTrigger
                    asset={previewAsset}
                    key={item.NodeID}
                    onReview={reviewAsset}
                    onVisibleChange={(visible) => setHoveredPreviewId(visible ? previewId : "")}
                    visible={hoveredPreviewId === previewId && draggingPreviewId !== previewId}
                  >
                    <button
                      className={styles.nodeItem}
                      onClick={onLocateNode ? () => onLocateNode(item.NodeID) : undefined}
                      onMouseEnter={() => setHoveredPreviewId(previewId)}
                      title={onLocateNode ? t("在画布中定位") : undefined}
                      type="button"
                    >
                      <CanvasNodeThumbnail
                        asset={previewAsset}
                        fallback={kind.icon}
                        item={item}
                        previewURL={previewURL}
                      />
                      <AssetStatusBadge asset={previewAsset} isPrimary={item.ResourceAssetIsPrimary === true} />
                      <span className={styles.nodeName}>
                        <HighlightedName query={keyword} text={name} />
                      </span>
                      {onLocateNode ? (
                        <span aria-label={t("在画布中定位")} className={styles.locateNode}>
                          <IconLocationNode />
                        </span>
                      ) : null}
                    </button>
                  </PreviewTrigger>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className={styles.assetBody}>
          <nav className={styles.typeNav}>
            {RESOURCE_TYPES.map((item) => (
              <button
                className={selectedType === item.value ? styles.activeTypeButton : styles.typeButton}
                key={item.value}
                onClick={() => setSelectedType(item.value)}
                type="button"
              >
                <span>
                  <ResourceTypeIcon type={item.value} />
                </span>
                {item.label}
              </button>
            ))}
          </nav>

          <section className={styles.assetContent}>
            <div className={styles.searchContainer}>
              <SearchInput
                className={styles.search}
                onChange={setKeyword}
                placeholder={t("输入名称搜索")}
                value={keyword}
              />
            </div>
            <input
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                const target = resourceUploadTargetRef.current;
                event.currentTarget.value = "";
                resourceUploadTargetRef.current = undefined;
                if (file && target) {
                  openResourceAction(target, { file, type: "upload" });
                }
              }}
              ref={resourceUploadInputRef}
              type="file"
            />
            <div className={styles.assetList}>
              {loading ? (
                <div className={styles.center}>
                  <Spin size={24} />
                </div>
              ) : groups.length === 0 ? (
                <div className={styles.empty}>{t("暂无项目资产")}</div>
              ) : selectedType === resource.ResourceType.AUDIO ? (
                groups.map(({ item }) => {
                  const primary = item.PrimaryResourceAsset;
                  const draggable = Boolean(primary?.ResourceAssetID);
                  const previewURL = resolveArtifactURL(primary?.PreviewURL ?? "");
                  const previewId = `resource:${item.ResourceID}`;
                  const previewAsset = withLatestReview(previewAssetForResource(item));
                  return (
                    <PreviewTrigger
                      asset={previewAsset}
                      key={item.ResourceID}
                      label={t("试听音频：{name}", { name: item.Name })}
                      onReview={item.OwnerType === resource.ResourceOwnerType.OFFICIAL ? undefined : reviewAsset}
                      onVisibleChange={(visible) => {
                        setHoveredPreviewId(visible ? previewId : "");
                      }}
                      showReviewStatus={item.OwnerType !== resource.ResourceOwnerType.OFFICIAL}
                      visible={hoveredPreviewId === previewId && draggingPreviewId !== previewId}
                    >
                      <div
                        aria-label={item.Name}
                        className={styles.assetItem}
                        draggable={draggable}
                        onDragEnd={() => setDraggingPreviewId("")}
                        onDragStart={(event) => {
                          if (!draggable) return;
                          setDraggingPreviewId(previewId);
                          setHoveredPreviewId("");
                          const data: CanvasAssetDragData = {
                            resourceId: item.ResourceID,
                            nodeType: canvasnode.CanvasNodeType.AUDIO_ASSET,
                            previewURL,
                          };
                          event.dataTransfer.effectAllowed = "copy";
                          event.dataTransfer.setData(CANVAS_ASSET_DRAG_TYPE, JSON.stringify(data));
                        }}
                        onMouseEnter={() => setHoveredPreviewId(previewId)}
                      >
                        <span className={`${styles.thumbnail} ${styles.fallbackThumbnail}`}>
                          <ResourceTypeIcon type={item.Type} />
                        </span>
                        <ReviewBadge asset={previewAsset} />
                        <span className={styles.assetName} title={item.Name}>
                          <HighlightedName query={keyword} text={item.Name} />
                        </span>
                      </div>
                    </PreviewTrigger>
                  );
                })
              ) : (
                <Collapse
                  activeKey={[...expandedGroupIds]}
                  bordered={false}
                  className={styles.groupCollapse}
                  expandIcon={<img alt="" className={styles.groupArrow} src={groupDownIcon} />}
                  lazyload={false}
                  onChange={(_, activeKeys) => {
                    setExpandedGroupIds(new Set(activeKeys));
                  }}
                >
                  {groups.map(({ item, assets }) => (
                    <Collapse.Item
                      extra={
                        item.OwnerType === resource.ResourceOwnerType.OFFICIAL ? null : (
                          <div onClick={(event) => event.stopPropagation()}>
                            <Dropdown
                              droplist={
                                <Menu
                                  onClickMenuItem={(key) => {
                                    if (key === "upload") {
                                      resourceUploadTargetRef.current = item;
                                      if (resourceUploadInputRef.current) {
                                        resourceUploadInputRef.current.accept = getResourceFileConfig(item.Type).accept;
                                      }
                                      resourceUploadInputRef.current?.click();
                                    } else if (key === "create") {
                                      openResourceAction(item, {
                                        type: "create",
                                      });
                                    }
                                  }}
                                >
                                  <Menu.Item key="upload">{t("本地上传")}</Menu.Item>
                                  <Menu.Item key="create">{t("新建")}</Menu.Item>
                                </Menu>
                              }
                              position="br"
                              trigger="click"
                            >
                              <button aria-label={t("新增资产")} className={styles.groupAdd} type="button">
                                <img alt="" className={styles.groupPlus} src={groupPlusIcon} />
                              </button>
                            </Dropdown>
                          </div>
                        )
                      }
                      header={renderResourceHeader(item)}
                      key={item.ResourceID}
                      name={item.ResourceID}
                    >
                      {expandedGroupIds.has(item.ResourceID) && !resourceAssets.has(item.ResourceID) ? (
                        <div className={styles.groupStatus}>
                          <Spin size={20} />
                        </div>
                      ) : assets.length === 0 ? (
                        <div className={styles.groupStatus}>{t("暂无可用素材")}</div>
                      ) : (
                        assets.map((asset) => {
                          const resourceAssetId = asset.ResourceAssetID;
                          const previewURL = resolveArtifactURL(asset.PreviewURL ?? "");
                          const hasCover = item.Type !== resource.ResourceType.AUDIO && Boolean(previewURL);
                          const previewId = `asset:${resourceAssetId}`;
                          const previewAsset = withLatestReview({
                            assetId: asset.CurrentAssetID,
                            category: categoryForMediaType(asset.MediaType),
                            description: item.Description,
                            id: asset.CurrentAssetID ?? resourceAssetId,
                            isPrimary: asset.IsPrimary,
                            previewUrl: previewURL,
                            resourceAssetId,
                            resourceId: item.ResourceID,
                            review: latestAssetReview(asset.Reviews),
                            reviews: asset.Reviews,
                            source: "project",
                            thumbnail: asset.MediaType === assetIDL.AssetMediaType.IMAGE ? previewURL : undefined,
                            title: asset.Name,
                          });
                          return (
                            <PreviewTrigger
                              asset={previewAsset}
                              key={resourceAssetId}
                              onReview={
                                item.OwnerType === resource.ResourceOwnerType.OFFICIAL ? undefined : reviewAsset
                              }
                              onVisibleChange={(visible) => setHoveredPreviewId(visible ? previewId : "")}
                              showReviewStatus={item.OwnerType !== resource.ResourceOwnerType.OFFICIAL}
                              visible={hoveredPreviewId === previewId && draggingPreviewId !== previewId}
                            >
                              <button
                                className={styles.assetItem}
                                draggable={Boolean(resourceAssetId)}
                                onDragEnd={() => setDraggingPreviewId("")}
                                onDragStart={(event) => {
                                  if (!resourceAssetId) return;
                                  setDraggingPreviewId(previewId);
                                  setHoveredPreviewId("");
                                  const data: CanvasAssetDragData = {
                                    resourceAssetId,
                                    nodeType: nodeTypeForResource(item.Type),
                                    previewURL,
                                  };
                                  event.dataTransfer.effectAllowed = "copy";
                                  event.dataTransfer.setData(CANVAS_ASSET_DRAG_TYPE, JSON.stringify(data));
                                }}
                                onMouseEnter={() => setHoveredPreviewId(previewId)}
                                type="button"
                              >
                                <span className={`${styles.thumbnail} ${hasCover ? "" : styles.fallbackThumbnail}`}>
                                  {hasCover ? <img alt="" src={previewURL} /> : <ResourceTypeIcon type={item.Type} />}
                                </span>
                                <AssetStatusBadge asset={previewAsset} isPrimary={asset.IsPrimary} />
                                <span className={styles.assetName} title={asset.Name}>
                                  <HighlightedName query={keyword} text={asset.Name} />
                                </span>
                              </button>
                            </PreviewTrigger>
                          );
                        })
                      )}
                    </Collapse.Item>
                  ))}
                </Collapse>
              )}
            </div>
          </section>
        </div>
      )}
      <ResourceDialog
        onClose={() => setDialogType(undefined)}
        onSuccess={() => setReloadKey((key) => key + 1)}
        projectId={projectId}
        state={dialogType === undefined ? undefined : { mode: "create", type: dialogType }}
      />
      {resourceModalState ? (
        <ResourceAssetsModal
          initialAction={resourceModalState.initialAction}
          item={resourceModalState.item}
          onChange={() => setReloadKey((key) => key + 1)}
          onClose={() => setResourceModalState(undefined)}
          projectId={projectId}
        />
      ) : null}
    </aside>
  );
}
