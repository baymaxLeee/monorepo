import { Button, Checkbox, Input, Tooltip, TooltipContent, TooltipTrigger } from "@repo/design-system";
import {
  ShieldCheck as IconComplianceLine,
  ShieldCheck as IconCompliancePlanarity,
  Trash2 as IconDeleteLine,
  Download as IconDownloadFine,
  Pencil as IconEdit,
  ImagePlus as IconGenerationImage,
  Pause as IconPause,
  Play as IconPlay,
} from "lucide-react";
import { type CSSProperties, type RefObject } from "react";

import { AudioSpectrum } from "@/components/AudioSpectrum/index";
import { EllipsisText } from "@/components/common";
import {
  renderAssetReviewTooltipContent,
  reviewStatusText,
} from "@/components/promptEditor/plugins/assetMention/ReviewStatus";
import { asset, resource } from "@/domain";
import { resolveArtifactURL } from "@/utils/artifactURL";
import { latestAssetReview } from "@/utils/assetReview";
import t from "@/utils/i18n";

import { ResourceTypeIcon } from "../components/ResourceTypeIcon";
import { ResourceGenerationFailureStatus } from "../generation/ResourceGenerationFailureStatus";
import { ResourceGenerationStatus } from "../generation/ResourceGenerationStatus";

import styles from "./ResourceAssetsPage.module.less";

type ResourceAssetCardProps = {
  file: resource.ResourceAsset;
  state: {
    batchSelecting: boolean;
    busy: boolean;
    isAudio: boolean;
    isOfficial: boolean;
    materialName: string;
    resourceType?: resource.ResourceType;
    selected: boolean;
    generating: boolean;
    generationFailed: boolean;
    playing: boolean;
    audioSpectrum: { fallback: boolean; heights: number[] };
  };
  rename: {
    renaming: boolean;
    renameValue: string;
    renameInputRef: RefObject<HTMLInputElement | null>;
    setRenameValue: (value: string) => void;
    cancelRename: () => void;
    saveRename: (file: resource.ResourceAsset) => void;
    startRename: (file: resource.ResourceAsset) => void;
  };
  actions: {
    openMaterialEditor: (file: resource.ResourceAsset) => void;
    toggleFile: (id: string) => void;
    stopGeneration: (file: resource.ResourceAsset) => void;
    setAsPrimary: (file: resource.ResourceAsset) => void;
    toggleAudioPlayback: (file: resource.ResourceAsset) => void;
    openReview: (file: resource.ResourceAsset) => void;
    confirmRemove: (file: resource.ResourceAsset) => void;
    downloadAsset: (file: resource.ResourceAsset) => void;
  };
};

const MATERIAL_ACTION_BUTTON_STYLE: CSSProperties = {
  alignItems: "center",
  backdropFilter: "blur(2px)",
  backgroundColor: "rgba(0, 0, 0, 0.5)",
  border: "1px solid var(--border)",
  borderRadius: 8,
  boxSizing: "border-box",
  color: "#fff",
  display: "flex",
  flex: "0 0 24px",
  fontSize: 16,
  height: 24,
  justifyContent: "center",
  lineHeight: 1,
  overflow: "hidden",
  padding: 0,
  position: "relative",
  width: 24,
};

const MATERIAL_ACTION_ICON_STYLE: CSSProperties = {
  alignItems: "center",
  display: "flex",
  inset: 0,
  justifyContent: "center",
  lineHeight: 0,
  position: "absolute",
};

function ResourceAssetReviewStatus({ file }: { file: resource.ResourceAsset }) {
  const review = latestAssetReview(file.Reviews);
  if (!review) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            aria-label={t("审核状态：{status}", {
              status: reviewStatusText(review),
            })}
            className={`${styles.reviewStatus} inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] text-[16px]`}
          >
            <IconCompliancePlanarity aria-hidden size={16} strokeWidth={1.5} />
          </span>
        }
      />
      <TooltipContent side="top">
        {renderAssetReviewTooltipContent({
          review,
          reviews: file.Reviews,
        })}
      </TooltipContent>
    </Tooltip>
  );
}

export function ResourceAssetCard({ file, state, rename, actions }: ResourceAssetCardProps) {
  const {
    batchSelecting,
    busy,
    isAudio,
    isOfficial,
    materialName,
    resourceType,
    selected,
    generating,
    generationFailed,
    playing,
    audioSpectrum,
  } = state;
  const { renaming, renameValue, renameInputRef, setRenameValue, cancelRename, saveRename, startRename } = rename;
  const {
    openMaterialEditor,
    toggleFile,
    stopGeneration,
    setAsPrimary,
    toggleAudioPlayback,
    openReview,
    confirmRemove,
    downloadAsset,
  } = actions;
  const selectionDisabled = busy || generating;
  return (
    <article
      className={`group relative w-full overflow-hidden rounded-[16px] border border-solid p-[3px] transition-colors duration-200 ${styles.materialCard} ${
        !batchSelecting && !busy && file.MediaType === asset.AssetMediaType.IMAGE ? "cursor-pointer" : ""
      } ${batchSelecting && !selected ? "opacity-50" : ""} ${
        selected ? "border-primary" : "border-[transparent] hover:border-muted-foreground"
      }`}
      key={file.ResourceAssetID}
    >
      {!batchSelecting && file.MediaType === asset.AssetMediaType.IMAGE ? (
        <Button
          aria-label={t("编辑{materialName}：{fileName}", { materialName, fileName: file.Name })}
          className="absolute inset-0 z-10 h-auto w-auto rounded-[16px] p-0 shadow-none"
          disabled={busy}
          onClick={() => openMaterialEditor(file)}
          variant="ghost"
        />
      ) : null}
      {batchSelecting ? (
        <>
          <Button
            aria-label={t("{selected}{materialName}：{fileName}", {
              selected: selected ? t("取消选择") : t("选择"),
              materialName,
              fileName: file.Name,
            })}
            className={`absolute inset-0 z-30 h-auto w-auto p-0 ${
              selectionDisabled ? "cursor-not-allowed" : "cursor-pointer"
            }`}
            disabled={selectionDisabled}
            onClick={() => {
              toggleFile(file.ResourceAssetID);
            }}
            type="button"
            variant="ghost"
          />
          <span className={styles.cardSelector}>
            <Checkbox
              aria-hidden="true"
              checked={selected}
              className={`${styles.cardSelectorCheckbox} pointer-events-none`}
              disabled={selectionDisabled}
              tabIndex={-1}
            />
          </span>
        </>
      ) : null}
      <div
        className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[12px] bg-muted text-[42px] text-muted-foreground ${styles.materialPreview}`}
      >
        {generating ? (
          <ResourceGenerationStatus fileName={file.Name} onStop={() => stopGeneration(file)} variant="card" />
        ) : generationFailed ? (
          <ResourceGenerationFailureStatus fileName={file.Name} />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {file.MediaType === asset.AssetMediaType.IMAGE && file.PreviewURL ? (
              <img
                alt={file.Name}
                className={`h-full w-full object-contain transition-transform duration-300 ease-out ${styles.materialPreviewImage}`}
                src={resolveArtifactURL(file.PreviewURL)}
              />
            ) : !(isAudio && file.PreviewURL) ? (
              file.MediaType === asset.AssetMediaType.IMAGE ? (
                <IconGenerationImage />
              ) : (
                <ResourceTypeIcon type={resourceType ?? resource.ResourceType.CHARACTER} />
              )
            ) : null}
            {file.IsPrimary ||
            file.Reviews?.length ||
            (!batchSelecting && !isOfficial && file.MediaType === asset.AssetMediaType.IMAGE) ? (
              <div className={styles.cardTopMeta}>
                {file.IsPrimary ? (
                  <span
                    className={`${styles.primaryTag} inline-flex h-6 items-center rounded-lg bg-primary/10 px-2 text-[13px] font-medium leading-5.5 text-primary`}
                  >
                    {t("主{materialName}", { materialName })}
                  </span>
                ) : null}
                {!batchSelecting &&
                !isOfficial &&
                !file.IsPrimary &&
                Boolean(file.CurrentAssetID) &&
                file.MediaType === asset.AssetMediaType.IMAGE ? (
                  <Tooltip>
                    <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
                      <Button
                        aria-disabled={busy || generating}
                        aria-label={t("设为主{materialName}：{fileName}", {
                          materialName,
                          fileName: file.Name,
                        })}
                        className={styles.setPrimaryButton}
                        onClick={() => {
                          if (!busy && !generating) setAsPrimary(file);
                        }}
                        onKeyDown={(event) => {
                          if (busy || generating || (event.key !== "Enter" && event.key !== " ")) return;
                          event.preventDefault();
                          setAsPrimary(file);
                        }}
                        type="button"
                        variant="ghost"
                        tabIndex={busy || generating ? -1 : 0}
                      >
                        {t("主{materialName}", { materialName })}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side={"top"}>
                      {t("设为主{materialName}", {
                        materialName,
                      })}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                <ResourceAssetReviewStatus file={file} />
              </div>
            ) : null}
          </div>
        )}
        {isAudio && file.PreviewURL && !batchSelecting ? (
          <div className={styles.audioPreviewControl}>
            <AudioSpectrum
              className={styles.audioSpectrum}
              fallback={audioSpectrum.fallback}
              heights={playing ? audioSpectrum.heights : undefined}
              playing={playing}
            />
            <Button
              variant="ghost"
              aria-label={t("{action}音频：{name}", {
                action: playing ? t("暂停") : t("播放"),
                name: file.Name,
              })}
              className={styles.audioPlayButton}
              disabled={busy}
              onClick={() => toggleAudioPlayback(file)}
              type="button"
            >
              {playing ? <IconPause /> : <IconPlay />}
            </Button>
          </div>
        ) : null}
        {!batchSelecting && file.MediaType === asset.AssetMediaType.IMAGE ? (
          <>
            <div className="absolute right-1 top-1 z-20 flex flex-col gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
                  <Button
                    variant="ghost"
                    aria-label={t("编辑{materialName}：{fileName}", {
                      materialName,
                      fileName: file.Name,
                    })}
                    className={styles.materialActionButton}
                    disabled={busy}
                    onClick={() => openMaterialEditor(file)}
                    style={MATERIAL_ACTION_BUTTON_STYLE}
                    type="button"
                  >
                    <span style={MATERIAL_ACTION_ICON_STYLE}>
                      <IconEdit aria-hidden className="text-white" size={16} strokeWidth={1.5} />
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={"left"}>{t("编辑")}</TooltipContent>
              </Tooltip>
              {!isOfficial && file.CurrentAssetID ? (
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
                    <Button
                      variant="ghost"
                      aria-label={t("合规审核{materialName}：{fileName}", {
                        materialName,
                        fileName: file.Name,
                      })}
                      className={styles.materialActionButton}
                      disabled={busy || generating}
                      onClick={() => openReview(file)}
                      style={MATERIAL_ACTION_BUTTON_STYLE}
                      type="button"
                    >
                      <span style={MATERIAL_ACTION_ICON_STYLE}>
                        <IconComplianceLine
                          aria-hidden
                          className="text-white"
                          size={16}
                          strokeWidth={1.5}
                          style={{
                            transform: "translateY(0.5px)",
                          }}
                        />
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side={"left"}>{t("合规审核")}</TooltipContent>
                </Tooltip>
              ) : null}
              {!isOfficial ? (
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
                    <Button
                      variant="ghost"
                      aria-label={t("删除{materialName}：{fileName}", {
                        materialName,
                        fileName: file.Name,
                      })}
                      className={styles.materialActionButton}
                      disabled={busy || generating}
                      onClick={() => confirmRemove(file)}
                      style={MATERIAL_ACTION_BUTTON_STYLE}
                      type="button"
                    >
                      <span style={MATERIAL_ACTION_ICON_STYLE}>
                        <IconDeleteLine aria-hidden className="text-white" size={16} strokeWidth={1.5} />
                      </span>
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side={"left"}>{t("删除")}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          </>
        ) : null}
        {!batchSelecting && isAudio ? (
          <div className="absolute right-1 top-1 z-20 flex flex-col gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {file.PreviewURL ? (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
                  <Button
                    variant="ghost"
                    aria-label={t("下载音频：{fileName}", {
                      fileName: file.Name,
                    })}
                    className={styles.materialActionButton}
                    disabled={busy || generating}
                    onClick={() => downloadAsset(file)}
                    style={MATERIAL_ACTION_BUTTON_STYLE}
                    type="button"
                  >
                    <span style={MATERIAL_ACTION_ICON_STYLE}>
                      <IconDownloadFine aria-hidden className="text-white" size={16} strokeWidth={1.5} />
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={"left"}>{t("下载")}</TooltipContent>
              </Tooltip>
            ) : null}
            {!isOfficial && file.CurrentAssetID ? (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
                  <Button
                    variant="ghost"
                    aria-label={t("合规审核{materialName}：{fileName}", {
                      materialName,
                      fileName: file.Name,
                    })}
                    className={styles.materialActionButton}
                    disabled={busy}
                    onClick={() => openReview(file)}
                    style={MATERIAL_ACTION_BUTTON_STYLE}
                    type="button"
                  >
                    <span style={MATERIAL_ACTION_ICON_STYLE}>
                      <IconComplianceLine aria-hidden className="text-white" size={16} strokeWidth={1.5} />
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={"left"}>{t("合规审核")}</TooltipContent>
              </Tooltip>
            ) : null}
            {!isOfficial ? (
              <Tooltip>
                <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
                  <Button
                    variant="ghost"
                    aria-label={t("删除{materialName}：{fileName}", {
                      materialName,
                      fileName: file.Name,
                    })}
                    className={styles.materialActionButton}
                    disabled={busy}
                    onClick={() => confirmRemove(file)}
                    style={MATERIAL_ACTION_BUTTON_STYLE}
                    type="button"
                  >
                    <span style={MATERIAL_ACTION_ICON_STYLE}>
                      <IconDeleteLine aria-hidden className="text-white" size={16} strokeWidth={1.5} />
                    </span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side={"left"}>{t("删除")}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col items-start justify-center px-3 py-4">
        {batchSelecting || isOfficial ? (
          <EllipsisText
            popoverProps={{ position: "top" }}
            className="w-full text-[16px] font-medium leading-6 text-foreground"
          >
            {file.Name}
          </EllipsisText>
        ) : renaming ? (
          <Input
            aria-label={t("重命名{materialName}：{fileName}", {
              materialName,
              fileName: file.Name,
            })}
            className="h-6 w-full min-w-0 border-0 bg-[transparent] p-0 text-[16px] font-medium leading-6 text-foreground outline-none"
            maxLength={100}
            onBlur={() => saveRename(file)}
            onChange={(event) => setRenameValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRenameValue(file.Name);
                cancelRename();
              }
            }}
            ref={renameInputRef}
            value={renameValue}
          />
        ) : (
          <div
            aria-label={t("重命名{materialName}：{fileName}", {
              materialName,
              fileName: file.Name,
            })}
            aria-disabled={busy || generating}
            className="w-full min-w-0 cursor-text border-0 bg-[transparent] p-0 text-left text-[16px] font-medium leading-6 text-foreground"
            onClick={() => startRename(file)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              startRename(file);
            }}
            role="button"
            tabIndex={0}
          >
            <EllipsisText popoverProps={{ position: "top" }} className="w-full">
              {file.Name}
            </EllipsisText>
          </div>
        )}
      </div>
    </article>
  );
}
