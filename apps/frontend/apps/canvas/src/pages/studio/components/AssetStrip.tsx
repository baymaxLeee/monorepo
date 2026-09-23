import { X as IconClose, Plus as IconPlus, ArrowLeftRight as IconSwitchover } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { ImagePreview } from "@/components/compat";
import { AssetAvatar, type AssetMentionSource } from "@/components/promptEditor/index";
import { AddAssetToLibraryDialog } from "@/components/promptEditor/plugins/assetMention/AddAssetToLibraryDialog";
import { AssetPreviewCard } from "@/components/promptEditor/plugins/assetMention/AssetPreviewCard";
import { Tooltip, Trigger } from "@/components/ui";
import { canvasnode } from "@/domain";
import {
  HIDDEN_SCROLLBAR_CLASS,
  HIDDEN_SCROLLBAR_STYLE,
  useHorizontalScrollFade,
} from "@/hooks/useHorizontalScrollFade";
import t from "@/utils/i18n";

import { ALL_ASSET_CATEGORIES, assetAccept, countAssetsByCategory, formatAssetStats } from "../domain/model";
import type { AssetCategory, StoryboardAsset } from "../domain/types";

const FORMAT_TIP_ITEMS: Record<AssetCategory, string> = {
  image: t("图片：jpeg、png、webp、bmp、tiff、gif、heic、heif，单张 30MB 以下"),
  video: t("视频：mp4、mov，单个不超过 200MB"),
  audio: t("音频：wav、mp3，单个不超过 15MB"),
};

function formatTip(categories: AssetCategory[]) {
  return (
    <div className="w-[232px] text-[12px] leading-5.5">
      {t("资产格式要求")}
      <ul className="my-1 list-disc pl-[18px]">
        {categories.map((category) => (
          <li key={category}>{FORMAT_TIP_ITEMS[category]}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 格式说明自带宽度，这里解除普通文字提示的尺寸约束，避免右侧文案被截断。
 */
const FORMAT_TIP_POPUP = "max-h-none max-w-none rounded-xl p-3";

const ADD_ASSET_BUTTON_CLASS =
  "flex h-[54px] w-[54px] shrink-0 items-center justify-center rounded-[12px] border border-dashed border-muted-foreground/40 bg-background p-0 text-[27px] text-muted-foreground outline-hidden focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const ACTIVE_ADD_ASSET_BUTTON_CLASS = "cursor-pointer hover:border-muted-foreground/70 hover:text-foreground";

function AssetThumb({
  interactionDisabled = false,
  editable,
  asset,
  reviewAsset,
  onAddToLibrary,
  onRemove,
}: {
  editable: boolean;
  interactionDisabled?: boolean;
  asset: StoryboardAsset;
  reviewAsset?: NonNullable<AssetMentionSource["review"]>;
  onAddToLibrary?: () => void;
  onRemove: (id: string) => void;
}) {
  // 仅图片素材支持点击查看大图；视频/音频缩略图走分类图标，无原图可看。
  const previewable = !interactionDisabled && asset.category === "image" && Boolean(asset.previewUrl);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [reviewOverride, setReviewOverride] = useState<StoryboardAsset["review"]>();
  const previewAsset = reviewOverride ? { ...asset, review: reviewOverride } : asset;

  return (
    <>
      <Trigger
        disabled={interactionDisabled || (!reviewAsset && !onAddToLibrary)}
        position="bl"
        popup={() => (
          <AssetPreviewCard
            asset={previewAsset}
            onAddToLibrary={onAddToLibrary ? () => onAddToLibrary() : undefined}
            onSubmitReview={reviewAsset ? (current) => reviewAsset(current, setReviewOverride) : undefined}
          />
        )}
        trigger="hover"
      >
        <div
          className={`group relative h-[54px] w-[54px] shrink-0 overflow-hidden rounded-[12px] bg-muted ${
            previewable ? "cursor-zoom-in" : ""
          }`}
          onClick={() => {
            if (previewable) {
              setPreviewVisible(true);
            }
          }}
        >
          {/* 分类图标按 1em 排版，字号即图标尺寸，取 54px 方格的 75%。 */}
          <AssetAvatar className="text-[40px]" asset={asset} fit="cover" />

          {asset.syncStatus === "failed" ? (
            <span className="absolute inset-0 flex items-center justify-center bg-[rgba(255,255,255,0.72)] text-[12px] text-destructive">
              {t("失败")}
            </span>
          ) : editable ? (
            <button
              aria-label={t("移除{title}", { title: asset.title })}
              className="absolute right-[5px] top-[5px] hidden h-4 w-4 cursor-pointer items-center justify-center rounded-[999px] border-0 bg-[rgba(0,0,0,0.5)] p-0 text-[10px] text-white group-hover:flex"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(asset.id);
              }}
              type="button"
            >
              <IconClose />
            </button>
          ) : null}
        </div>
      </Trigger>

      {/*
       * Image.Preview 必须置于缩略图 div 之外：它经 Portal 渲染，但 React 合成事件
       * 仍沿组件树冒泡。若嵌在带 onClick 的 div 内，点击预览层关闭按钮会冒泡回该 div
       * 的 onClick 再次 setPreviewVisible(true)，导致预览关不掉。
       */}
      {previewable ? (
        <ImagePreview src={asset.previewUrl as string} visible={previewVisible} onVisibleChange={setPreviewVisible} />
      ) : null}
    </>
  );
}

/** 资产与提示词同属「编辑」按钮的管控范围，非编辑态只展示、不提供增删入口。 */
const MAX_FILES_PER_SELECTION = 10;

export function AssetStrip({
  interactionDisabled = false,
  statsPrefix,
  addAssetToLibrary,
  editable,
  assetLimits,
  assets,
  categories = ALL_ASSET_CATEGORIES,
  emptyHint = t("键入 @ 可快速调整镜头时长、引用资产"),
  reserveEmptySpace = false,
  showStats = true,
  statsLabel,
  onRemove,
  reviewAsset,
  onSwapFrames,
  swapFramesDisabled = !editable,
  onUpload,
  videoInputMode = canvasnode.CanvasVideoInputMode.REFERENCE,
}: {
  addAssetToLibrary?: NonNullable<AssetMentionSource["addToLibrary"]>;
  editable: boolean;
  /** 由当前生成模型能力提供。 */
  assetLimits: Record<"image" | "video" | "audio", number>;
  /** 允许上传/统计的资产类别，默认三类全开；传子集可限制（如只图片）。 */
  categories?: AssetCategory[];
  /** 无素材时的提示文案；不同场景（分镜 / 图生图）可覆盖。传空串则不展示。 */
  emptyHint?: string;
  /** 故事板始终预留素材行，避免切换空分镜或编辑态时正文跳动。 */
  reserveEmptySpace?: boolean;
  assets: StoryboardAsset[];
  /** 紧凑生成面板可隐藏统计行；默认保留分镜编辑器现有展示。 */
  showStats?: boolean;
  statsPrefix?: ReactNode;
  interactionDisabled?: boolean;
  /** 复用到生图编辑器时可把默认“素材统计”替换为“参考图统计”。 */
  statsLabel?: string;
  onRemove: (id: string) => void;
  reviewAsset?: NonNullable<AssetMentionSource["review"]>;
  onSwapFrames?: () => void;
  /** 可独立于素材增删开放交换；默认遵循 editable。 */
  swapFramesDisabled?: boolean;
  onUpload: (files: File[], targetPort?: canvasnode.CanvasPort) => void | Promise<void>;
  videoInputMode?: canvasnode.CanvasVideoInputMode;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingFramePortRef = useRef<canvasnode.CanvasPort | undefined>(undefined);
  const [libraryAsset, setLibraryAsset] = useState<StoryboardAsset>();
  const { contentRef, maskImage, scrollRef } = useHorizontalScrollFade();

  const counts = countAssetsByCategory(assets);
  const firstLastFrame = videoInputMode === canvasnode.CanvasVideoInputMode.FIRST_LAST_FRAME;
  const imageAssets = assets.filter((asset) => asset.category === "image");
  const firstFrame = imageAssets.find((asset) => asset.targetPort === canvasnode.CanvasPort.FIRST_FRAME);
  const lastFrame = imageAssets.find((asset) => asset.targetPort === canvasnode.CanvasPort.LAST_FRAME);
  const unassignedFrames = imageAssets.filter(
    (asset) =>
      asset.targetPort !== canvasnode.CanvasPort.FIRST_FRAME && asset.targetPort !== canvasnode.CanvasPort.LAST_FRAME,
  );
  const frameAssets = [firstFrame ?? unassignedFrames.shift(), lastFrame ?? unassignedFrames.shift()];
  const canSwapFrames = !swapFramesDisabled && frameAssets.every(Boolean) && Boolean(onSwapFrames);

  const openPicker = (targetPort?: canvasnode.CanvasPort) => {
    pendingFramePortRef.current = targetPort;
    inputRef.current?.click();
  };

  return (
    <div className="shrink-0">
      <div
        style={interactionDisabled ? { opacity: 0.3, pointerEvents: "none" } : undefined}
        inert={interactionDisabled || undefined}
        className={`flex items-start gap-3 ${reserveEmptySpace ? "min-h-[58px]" : ""}`}
      >
        {firstLastFrame ? (
          <div className="flex items-start gap-3">
            {[t("首帧"), t("尾帧")].map((label, index) => {
              const frame = frameAssets[index];
              const frameSlot = (
                <div className="flex flex-col items-center gap-1" key={label}>
                  {frame ? (
                    <AssetThumb
                      interactionDisabled={interactionDisabled}
                      asset={frame}
                      editable={editable}
                      onAddToLibrary={
                        addAssetToLibrary &&
                        frame.source === "canvasnode" &&
                        Boolean(frame.assetId) &&
                        !frame.id.startsWith("draft-")
                          ? () => setLibraryAsset(frame)
                          : undefined
                      }
                      onRemove={onRemove}
                      reviewAsset={
                        reviewAsset && (Boolean(frame.assetId) || frame.id.startsWith("draft-"))
                          ? reviewAsset
                          : undefined
                      }
                    />
                  ) : (
                    <button
                      aria-label={t("添加{label}", { label })}
                      className={`${ADD_ASSET_BUTTON_CLASS} ${ACTIVE_ADD_ASSET_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                      disabled={!editable}
                      onClick={() =>
                        openPicker(index === 0 ? canvasnode.CanvasPort.FIRST_FRAME : canvasnode.CanvasPort.LAST_FRAME)
                      }
                      type="button"
                    >
                      <IconPlus />
                    </button>
                  )}
                  <span className="text-[12px] leading-4.5 text-muted-foreground">{label}</span>
                </div>
              );
              if (index === 0) {
                return (
                  <div className="flex items-start gap-3" key={label}>
                    {frameSlot}
                    <Tooltip content={t("左右图切换")} position="top">
                      <button
                        aria-disabled={!canSwapFrames}
                        aria-label={t("左右图切换")}
                        className={`mt-[15px] flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] border-0 bg-[transparent] p-0 text-[16px] text-foreground ${
                          canSwapFrames ? "cursor-pointer hover:bg-muted!" : "cursor-not-allowed"
                        }`}
                        onClick={canSwapFrames ? onSwapFrames : undefined}
                        type="button"
                      >
                        <IconSwitchover />
                      </button>
                    </Tooltip>
                  </div>
                );
              }
              return frameSlot;
            })}
          </div>
        ) : assets.length ? (
          <div
            className={`min-w-0 overflow-x-auto pb-1 ${HIDDEN_SCROLLBAR_CLASS}`}
            ref={scrollRef}
            style={{
              ...HIDDEN_SCROLLBAR_STYLE,
              maskImage,
              WebkitMaskImage: maskImage,
            }}
          >
            <div className="flex w-max gap-3" ref={contentRef}>
              {assets.map((asset) => (
                <AssetThumb
                  interactionDisabled={interactionDisabled}
                  editable={editable}
                  key={asset.draftId ?? asset.id}
                  asset={asset}
                  onAddToLibrary={
                    addAssetToLibrary &&
                    asset.source === "canvasnode" &&
                    Boolean(asset.assetId) &&
                    !asset.id.startsWith("draft-") &&
                    asset.category !== "video" &&
                    asset.category !== "text"
                      ? () => setLibraryAsset(asset)
                      : undefined
                  }
                  onRemove={onRemove}
                  reviewAsset={
                    reviewAsset && (Boolean(asset.assetId) || asset.id.startsWith("draft-")) ? reviewAsset : undefined
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {(editable || (reserveEmptySpace && assets.length === 0)) && !firstLastFrame ? (
          <>
            <Tooltip className={FORMAT_TIP_POPUP} content={formatTip(categories)} position="bottom">
              <span className="inline-flex shrink-0">
                <button
                  aria-label={t("上传资产")}
                  className={`${ADD_ASSET_BUTTON_CLASS} ${editable ? ACTIVE_ADD_ASSET_BUTTON_CLASS : ""}`}
                  disabled={!editable}
                  onClick={() => openPicker()}
                  type="button"
                >
                  <IconPlus />
                </button>
              </span>
            </Tooltip>
          </>
        ) : null}

        {editable ? (
          <input
            accept={firstLastFrame ? assetAccept(["image"]) : assetAccept(categories)}
            className="hidden"
            multiple={!firstLastFrame}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []).slice(0, firstLastFrame ? 1 : MAX_FILES_PER_SELECTION);
              if (files.length) {
                void onUpload(files, pendingFramePortRef.current);
              }
              pendingFramePortRef.current = undefined;
              event.target.value = "";
            }}
            ref={inputRef}
            type="file"
          />
        ) : null}

        {(editable || reserveEmptySpace) && !firstLastFrame && assets.length === 0 && emptyHint ? (
          <p className="m-0 self-center text-[14px] leading-5.5 text-muted-foreground">{emptyHint}</p>
        ) : null}
      </div>
      {showStats ? (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 12,
          }}
        >
          {statsPrefix}
          <p className="m-0 text-[13px] leading-5.5 text-muted-foreground">
            {formatAssetStats(counts, assetLimits, categories, statsLabel)}
          </p>
        </div>
      ) : null}
      {addAssetToLibrary ? (
        <AddAssetToLibraryDialog
          asset={libraryAsset}
          onClose={() => setLibraryAsset(undefined)}
          onSubmit={addAssetToLibrary}
        />
      ) : null}
    </div>
  );
}
