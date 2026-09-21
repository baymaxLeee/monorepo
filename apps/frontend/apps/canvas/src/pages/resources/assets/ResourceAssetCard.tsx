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
import { EllipsisText as CEllipsis } from "@/components/compat";
import {
  renderAssetReviewTooltipContent,
  reviewStatusText,
} from "@/components/promptEditor/plugins/assetMention/ReviewStatus";
import { Checkbox, Tooltip } from "@/components/ui";
import { asset, resource } from "@/domain";
import { latestAssetReview } from "@/utils/assetReview";
import t from "@/utils/i18n";
import { resolveUpPreviewURL } from "@/utils/upPreviewURL";

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
    renameInputRef: RefObject<HTMLInputElement>;
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
  border: "1px solid var(--color-border-4)",
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
    <Tooltip
      content={renderAssetReviewTooltipContent({
        review,
        reviews: file.Reviews,
      })}
      position="top"
    >
      <span
        aria-label={t("审核状态：{status}", {
          status: reviewStatusText(review),
        })}
        className={`${styles.reviewStatus} inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-[8px] text-[16px]`}
      >
        <IconCompliancePlanarity />
      </span>
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
        selected
          ? "border-[color:rgb(var(--primary-6))]"
          : "border-[transparent] hover:border-[color:var(--color-text-3)]"
      }`}
      key={file.ResourceAssetID}
      onClick={(event) => {
        if (
          batchSelecting ||
          busy ||
          file.MediaType !== asset.AssetMediaType.IMAGE ||
          (event.target instanceof Element && event.target.closest('button, input, [role="button"]'))
        )
          return;
        openMaterialEditor(file);
      }}
    >
      {batchSelecting ? (
        <>
          <div
            aria-disabled={selectionDisabled}
            aria-label={t("{selected}{materialName}：{fileName}", {
              selected: selected ? t("取消选择") : t("选择"),
              materialName,
              fileName: file.Name,
            })}
            className={`absolute inset-0 z-30 ${selectionDisabled ? "cursor-not-allowed" : "cursor-pointer"}`}
            onClick={() => {
              if (!selectionDisabled) toggleFile(file.ResourceAssetID);
            }}
            onKeyDown={(event) => {
              if (selectionDisabled || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              toggleFile(file.ResourceAssetID);
            }}
            role="button"
            tabIndex={selectionDisabled ? -1 : 0}
          />
          <span className={styles.cardSelector}>
            <Checkbox
              checked={selected}
              className={styles.cardSelectorCheckbox}
              disabled={selectionDisabled}
              onChange={() => toggleFile(file.ResourceAssetID)}
            />
          </span>
        </>
      ) : null}
      <div
        className={`relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-[12px] bg-[color:var(--color-bg-5)] text-[42px] text-[color:var(--color-grey-4)] ${styles.materialPreview}`}
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
                src={resolveUpPreviewURL(file.PreviewURL)}
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
                    className={`${styles.primaryTag} inline-flex h-6 items-center rounded-[8px] bg-[#c6e4ff] px-2 text-[13px] font-medium leading-5.5 text-[#031a79]`}
                  >
                    {t("主{materialName}", { materialName })}
                  </span>
                ) : null}
                {!batchSelecting &&
                !isOfficial &&
                !file.IsPrimary &&
                Boolean(file.CurrentAssetID) &&
                file.MediaType === asset.AssetMediaType.IMAGE ? (
                  <Tooltip
                    content={t("设为主{materialName}", {
                      materialName,
                    })}
                    position="top"
                  >
                    <span
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
                      role="button"
                      tabIndex={busy || generating ? -1 : 0}
                    >
                      {t("主{materialName}", { materialName })}
                    </span>
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
            <button
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
            </button>
          </div>
        ) : null}
        {!batchSelecting && file.MediaType === asset.AssetMediaType.IMAGE ? (
          <>
            <div className="absolute right-1 top-1 z-20 flex flex-col gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <Tooltip content={t("编辑")} position="left">
                <button
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
                    <IconEdit className="text-white" style={{ color: "#fff" }} />
                  </span>
                </button>
              </Tooltip>
              {!isOfficial && file.CurrentAssetID ? (
                <Tooltip content={t("合规审核")} position="left">
                  <button
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
                        className="text-white"
                        style={{
                          color: "#fff",
                          transform: "translateY(0.5px)",
                        }}
                      />
                    </span>
                  </button>
                </Tooltip>
              ) : null}
              {!isOfficial ? (
                <Tooltip content={t("删除")} position="left">
                  <button
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
                      <IconDeleteLine className="text-white" style={{ color: "#fff" }} />
                    </span>
                  </button>
                </Tooltip>
              ) : null}
            </div>
          </>
        ) : null}
        {!batchSelecting && isAudio ? (
          <div className="absolute right-1 top-1 z-20 flex flex-col gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {file.PreviewURL ? (
              <Tooltip content={t("下载")} position="left">
                <button
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
                    <IconDownloadFine className="text-white" style={{ color: "#fff" }} />
                  </span>
                </button>
              </Tooltip>
            ) : null}
            {!isOfficial && file.CurrentAssetID ? (
              <Tooltip content={t("合规审核")} position="left">
                <button
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
                    <IconComplianceLine className="text-white" style={{ color: "#fff" }} />
                  </span>
                </button>
              </Tooltip>
            ) : null}
            {!isOfficial ? (
              <Tooltip content={t("删除")} position="left">
                <button
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
                    <IconDeleteLine className="text-white" style={{ color: "#fff" }} />
                  </span>
                </button>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col items-start justify-center px-3 py-4">
        {batchSelecting || isOfficial ? (
          <CEllipsis
            popoverProps={{ position: "top" }}
            className="w-full text-[16px] font-medium leading-6 text-[color:var(--color-text-1)]"
            useCursorPointer={false}
          >
            {file.Name}
          </CEllipsis>
        ) : renaming ? (
          <input
            aria-label={t("重命名{materialName}：{fileName}", {
              materialName,
              fileName: file.Name,
            })}
            className="h-6 w-full min-w-0 border-0 bg-[transparent] p-0 text-[16px] font-medium leading-6 text-[color:var(--color-text-1)] outline-none"
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
            className="w-full min-w-0 cursor-text border-0 bg-[transparent] p-0 text-left text-[16px] font-medium leading-6 text-[color:var(--color-text-1)]"
            onClick={() => startRename(file)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              startRename(file);
            }}
            role="button"
            tabIndex={0}
          >
            <CEllipsis popoverProps={{ position: "top" }} className="w-full" useCursorPointer={false}>
              {file.Name}
            </CEllipsis>
          </div>
        )}
      </div>
    </article>
  );
}
