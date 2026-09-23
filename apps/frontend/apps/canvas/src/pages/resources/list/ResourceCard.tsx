import {
  ShieldCheck as IconComplianceLine,
  Download as IconDownloadFine,
  ImagePlus as IconGenerationImage,
  EllipsisVertical as IconMoreVertical1,
  Pause as IconPause,
  Play as IconPlay,
} from "lucide-react";

import { AudioSpectrum } from "@/components/AudioSpectrum/index";
import { EllipsisText as CEllipsis, OperationMenu as COperationMenu } from "@/components/compat";
import { Checkbox, Button, Tooltip } from "@/components/ui";
import { resource } from "@/domain";
import { resolveArtifactURL } from "@/utils/artifactURL";
import t from "@/utils/i18n";

import { ResourceTypeIcon } from "../components/ResourceTypeIcon";

import styles from "../index.module.less";

function getResourceAssetTypeLabel(type: resource.ResourceType) {
  switch (type) {
    case resource.ResourceType.CHARACTER:
      return t("形象");
    case resource.ResourceType.SCENE:
      return t("场景");
    case resource.ResourceType.PROP:
      return t("道具");
    case resource.ResourceType.AUDIO:
      return t("音频");
    default:
      return t("素材");
  }
}

export function ResourceCard({
  item,
  onManage,
  onEdit,
  onReview,
  onDelete,
  onSelect,
  selectable,
  selected,
  selecting,
  playing,
  spectrumFallback,
  spectrumHeights,
  onToggleAudio,
  onChooseAudio,
  onDownloadAudio,
  audioPending,
}: {
  item: resource.Resource;
  onManage: () => void;
  onEdit: () => void;
  onReview: () => void;
  onDelete: () => void;
  onSelect: () => void;
  selectable: boolean;
  selected: boolean;
  selecting: boolean;
  playing: boolean;
  spectrumFallback: boolean;
  spectrumHeights: number[];
  onToggleAudio: () => void;
  onChooseAudio: () => void;
  onDownloadAudio: () => void;
  audioPending: boolean;
}) {
  const primary = item.PrimaryResourceAsset;
  const isAudio = item.Type === resource.ResourceType.AUDIO;
  const primaryAudioURL = isAudio && primary?.PreviewURL ? resolveArtifactURL(primary.PreviewURL) : undefined;
  const previewURL = isAudio ? undefined : resolveArtifactURL(primary?.PreviewURL ?? "");
  const typeIcon = <ResourceTypeIcon type={item.Type} />;
  // 官方资源（预置音色）只读：不提供编辑与删除入口，卡片展示预置标签。
  const isOfficial = item.OwnerType === resource.ResourceOwnerType.OFFICIAL;
  const approvedResourceAssetCount = item.ApprovedResourceAssetCount ?? 0;
  const assetTypeLabel = getResourceAssetTypeLabel(item.Type);
  return (
    <article
      className={`group relative w-full overflow-hidden rounded-[16px] border border-solid p-[3px] transition-colors duration-200 ${
        selected ? "border-primary" : "border-[transparent] hover:border-muted-foreground"
      } ${selecting && !selected ? "opacity-50" : ""}`}
    >
      <button
        aria-label={
          selecting
            ? t("{action}资产：{name}", {
                action: selected ? t("取消选择") : t("选择"),
                name: item.Name,
              })
            : t("管理资产：{name}", { name: item.Name })
        }
        className={`flex w-full flex-col gap-3 border-0 bg-[transparent] p-0 pb-4 text-left ${
          isAudio && !selecting ? "cursor-default" : "cursor-pointer"
        }`}
        disabled={Boolean((selecting && !selectable) || (isAudio && !selecting))}
        onClick={selecting ? onSelect : onManage}
        type="button"
      >
        <div className={`relative aspect-video w-full overflow-hidden rounded-[12px] ${styles.resourceCover}`}>
          {previewURL ? (
            <img
              alt={item.Name}
              className={`absolute inset-0 h-full w-full object-contain transition-transform duration-300 ease-out ${styles.resourceCoverImage}`}
              src={previewURL}
            />
          ) : !primaryAudioURL ? (
            <span className="relative z-10 text-[42px] text-muted-foreground">
              {item.Type === resource.ResourceType.AUDIO ? typeIcon : <IconGenerationImage />}
            </span>
          ) : null}
          {isOfficial ? (
            <Tooltip
              content={isAudio ? t("官方预置，仅支持试听与下载") : t("官方预置，仅支持查看与下载")}
              position="top"
            >
              <span className="absolute bottom-[5px] left-[6px] inline-flex h-4 items-center rounded-[8px] bg-[rgba(0,0,0,0.5)] px-[6px] text-[10px] font-medium leading-4 text-white">
                {t("预置")}
              </span>
            </Tooltip>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 px-3">
          <h2 className="m-0 text-[16px] font-medium leading-6 text-foreground group-hover:text-primary">
            <CEllipsis>{item.Name}</CEllipsis>
          </h2>
          <div className="flex items-center gap-2">
            <Tooltip
              content={t("包含 {count} 个{assetType}", {
                count: item.ResourceAssetCount,
                assetType: assetTypeLabel,
              })}
              position="top"
            >
              <span
                aria-label={t("{count} 个素材", {
                  count: item.ResourceAssetCount,
                })}
                className="inline-flex h-[22px] w-fit items-center gap-1 rounded-[8px] bg-muted px-[6px] text-[13px] leading-5.5 text-muted-foreground"
              >
                <span className="inline-flex text-[14px]">{typeIcon}</span>
                {item.ResourceAssetCount}
              </span>
            </Tooltip>
            {!isOfficial ? (
              <Tooltip
                content={t("{count} 个{assetType}已审核通过", {
                  count: approvedResourceAssetCount,
                  assetType: assetTypeLabel,
                })}
                position="top"
              >
                <span
                  aria-label={t("{count} 个已审核通过素材", {
                    count: approvedResourceAssetCount,
                  })}
                  className="inline-flex h-[22px] w-fit items-center gap-1 rounded-[8px] bg-muted px-[6px] text-[13px] leading-5.5 text-muted-foreground"
                >
                  <span className="inline-flex text-[14px]">
                    <IconComplianceLine aria-hidden size="1em" strokeWidth={1.5} />
                  </span>
                  {approvedResourceAssetCount}
                </span>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </button>
      {primaryAudioURL && !selecting ? (
        <div className={styles.audioPreviewControl}>
          <AudioSpectrum
            className={styles.audioSpectrum}
            fallback={spectrumFallback}
            heights={playing ? spectrumHeights : undefined}
            playing={playing}
          />
          <button
            aria-label={t("{action}音频：{name}", {
              action: playing ? t("暂停") : t("播放"),
              name: item.Name,
            })}
            className={styles.audioPlayButton}
            onClick={onToggleAudio}
            type="button"
          >
            {playing ? <IconPause /> : <IconPlay />}
          </button>
        </div>
      ) : null}
      {selecting && selectable ? (
        <div className={styles.cardSelector} onClick={(event) => event.stopPropagation()}>
          <Checkbox checked={selected} className={styles.cardSelectorCheckbox} onChange={onSelect} />
        </div>
      ) : null}
      {!selecting && (isAudio || !isOfficial) ? (
        <div className={styles.cardOperations}>
          {isAudio ? (
            <Tooltip content={t("下载")} position="top">
              <Button
                aria-label={t("下载音频：{name}", { name: item.Name })}
                className={styles.audioDownloadButton}
                disabled={audioPending || !primaryAudioURL}
                icon={<IconDownloadFine />}
                onClick={onDownloadAudio}
                size="mini"
                type="outline"
              />
            </Tooltip>
          ) : null}
          {!isOfficial ? (
            <COperationMenu
              className={styles.cardOperationMenu}
              defaultButtonType="outline"
              displayNum={0}
              menuButtonProps={{
                icon: <IconMoreVertical1 />,
                size: "mini",
                type: "outline",
              }}
              operations={[
                ...(isAudio
                  ? [
                      {
                        name: primary ? t("替换音频") : t("上传音频"),
                        disabled: audioPending,
                        onClick: onChooseAudio,
                      },
                    ]
                  : []),
                { name: t("编辑"), onClick: onEdit },
                ...(item.Type === resource.ResourceType.CHARACTER || isAudio
                  ? [{ name: t("合规审核"), onClick: onReview }]
                  : []),
                {
                  name: t("删除"),
                  buttonProps: { status: "danger" as const },
                  onClick: onDelete,
                },
              ]}
              spaceSize={8}
              buttonProps={{ size: "mini" }}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
