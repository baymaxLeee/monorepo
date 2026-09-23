import {
  X as IconClose,
  GripVertical as IconDrag,
  CircleAlert as IconExclamationCircleRedFill,
  LoaderCircle as IconLoading,
  Video as IconVideoDefault,
} from "lucide-react";

import { openDeleteConfirmDialog } from "@/components/common";
import { Tooltip } from "@/components/ui";
import t from "@/utils/i18n";

import { shotChipLabel } from "../domain/model";
import type { Shot } from "../domain/types";

const OVERLAY_CLASS =
  "pointer-events-none absolute inset-0 flex items-center justify-center gap-1 text-[12px] leading-5";

export function ShotCard({
  deleteDisabledReason,
  disabled = false,
  index,
  playing = false,
  selected,
  shot,
  onRemove,
  onSelect,
}: {
  deleteDisabledReason?: string;
  disabled?: boolean;
  index: number;
  playing?: boolean;
  selected: boolean;
  shot: Shot;
  onRemove: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const failureReason = shot.generationErrorMessage;
  const label = shot.name || shotChipLabel(index);
  const creating = shot.timelineStatus === "creating";
  const locked = disabled || creating;
  const settled = shot.status === "ready" || shot.status === "empty";
  const failed = shot.status === "failed";
  const firstFrameURL = !shot.thumbnail ? shot.firstFrameUrl : undefined;
  const firstFrameErrorCode = undefined;
  const firstFrameErrorMessage = undefined;
  const thumbnail = shot.thumbnail ?? firstFrameURL;

  const removeBadge = (
    <button
      aria-label={`${t("删除{label}", { label })}`}
      className={`absolute right-[4px] top-[4px] hidden h-4 w-4 items-center justify-center rounded-[999px] border-0 bg-[rgba(0,0,0,0.5)] p-0 text-[10px] text-white group-hover:flex ${
        deleteDisabledReason ? "cursor-not-allowed" : "cursor-pointer"
      }`}
      onClick={() => {
        if (!deleteDisabledReason) {
          openDeleteConfirmDialog({
            name: t("分镜"),
            info: <span className="block px-6">{t("删除分镜后不可恢复，请谨慎操作。")}</span>,
            className: "w-[400px]! max-w-[calc(100vw-48px)]!",
            onOk: () => onRemove(shot.id),
          });
        }
      }}
      type="button"
    >
      <IconClose />
    </button>
  );

  return (
    <div className="relative flex w-[138px] shrink-0 flex-col items-center gap-1">
      <div
        className={`group relative h-[78px] w-full overflow-hidden rounded-[12px] bg-muted ${
          selected || playing ? "shadow-[0_0_0_6px_#bedaff]" : ""
        }`}
      >
        {shot.status === "generating" || failed ? null : thumbnail ? (
          <img alt={firstFrameURL ? t("分镜首帧") : ""} className="h-full w-full object-contain" src={thumbnail} />
        ) : (
          <span
            className="flex h-full w-full items-center justify-center text-[24px] text-muted-foreground"
            title={firstFrameErrorMessage ?? firstFrameErrorCode}
          >
            <IconVideoDefault />
          </span>
        )}

        {creating ? (
          <span className={`${OVERLAY_CLASS} bg-[rgba(255,255,255,0.86)] text-foreground`}>
            <IconLoading aria-hidden className="animate-spin" fontSize={14} />
            {t("分镜创建中")}
          </span>
        ) : shot.status === "generating" ? (
          <span className={`${OVERLAY_CLASS} bg-[rgba(0,0,0,0.5)] text-white`}>
            <IconLoading aria-hidden className="animate-spin" fontSize={14} />
            {t("视频生成中")}
          </span>
        ) : failed ? (
          <span
            className={`${OVERLAY_CLASS} bg-[rgba(215,49,42,0.1)] text-destructive`}
            title={failureReason || t("视频生成失败，请重试")}
          >
            <IconExclamationCircleRedFill aria-hidden className="text-[14px]" />
            {t("视频生成失败")}
          </span>
        ) : null}

        {settled ? (
          <>
            {thumbnail || shot.videoUrl ? (
              <span className="pointer-events-none absolute bottom-[4px] left-[4px] rounded-[8px] bg-[rgba(0,0,0,0.5)] px-[6px] py-[3px] text-[10px] font-medium leading-2.75 text-white">
                {shot.duration === "-1s" ? t("自动") : shot.duration}
              </span>
            ) : null}
            <span className="pointer-events-none absolute inset-0 hidden bg-[rgba(0,0,0,0.3)] group-hover:block" />
          </>
        ) : null}

        <button
          aria-current={selected}
          aria-label={`${t("选择{label}", { label })}`}
          className={`absolute inset-0 border-0 bg-[transparent] p-0 ${
            disabled ? "cursor-not-allowed" : "cursor-pointer"
          }`}
          disabled={locked}
          onClick={() => onSelect(shot.id)}
          type="button"
        />

        {(settled || failed) && !disabled ? (
          deleteDisabledReason ? (
            <Tooltip content={deleteDisabledReason} position="top">
              {removeBadge}
            </Tooltip>
          ) : (
            removeBadge
          )
        ) : null}
      </div>

      <span
        className="flex max-w-full items-center gap-1 text-[12px] capitalize leading-5 text-foreground"
        title={label}
      >
        <IconDrag aria-hidden className="h-[14px] w-[14px] shrink-0 text-foreground" />
        <span className="min-w-0 truncate">{label}</span>
      </span>

      {/*
       * 播放定位标记，只指示当前播放到哪个分镜，不承载进度。
       * 绝对定位挂在分镜底部（容器的 4px 下内边距里），避免占位把标签顶上去。
       */}
      {playing ? (
        <span
          aria-label={t("正在播放")}
          className="pointer-events-none absolute bottom-[-4px] left-[64px] h-0 w-0 border-solid border-b-[7px] border-l-[5px] border-r-[5px] border-t-0 border-b-foreground border-l-[transparent] border-r-[transparent]"
          role="img"
        />
      ) : null}
    </div>
  );
}
