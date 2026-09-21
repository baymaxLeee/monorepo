import {
  CircleCheck as IconCheckCircleFill,
  CircleX as IconCloseCircleFill,
  X as IconClose,
  LoaderCircle as IconLoading,
} from "lucide-react";

import { Tooltip } from "@/components/ui";
import t from "@/utils/i18n";

/**
 * 批量分镜脚本生成任务的时间轴占位：关闭预览弹窗后 SSE 继续跑，
 * 用户点「查看分镜」再打开弹窗做采纳确认。
 */
export function ScriptDraftCard({
  generating,
  onDismiss,
  onOpen,
  status,
}: {
  generating: boolean;
  onDismiss: () => void;
  onOpen: () => void;
  status: "running" | "completed" | "failed";
}) {
  const removeBadge = (
    <button
      aria-label={generating ? t("分镜识别中，无法删除") : t("关闭分镜脚本草稿")}
      className={`flex h-4 w-4 items-center justify-center rounded-[999px] border-0 bg-[rgba(255,255,255,0.16)] p-0 text-[10px] text-white ${
        generating ? "cursor-not-allowed opacity-50" : "cursor-pointer"
      }`}
      onClick={(event) => {
        event.stopPropagation();
        if (!generating) {
          onDismiss();
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
        className="relative flex h-[78px] w-full cursor-pointer flex-col items-center justify-center gap-1 overflow-hidden rounded-[12px] bg-[rgba(26,27,30,0.9)] px-2"
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        role="button"
        tabIndex={0}
      >
        {generating ? (
          <IconLoading className="text-white" fontSize={16} />
        ) : status === "failed" ? (
          <IconCloseCircleFill className="text-[18px] text-[color:rgb(var(--danger-6))]" />
        ) : (
          <IconCheckCircleFill className="text-[18px] text-[color:rgb(var(--success-6))]" />
        )}
        <span className="text-[11px] leading-4.25 text-white">
          {generating ? t("分镜脚本生成中") : status === "failed" ? t("分镜脚本生成失败") : t("分镜脚本已生成")}
        </span>
        {/* agentframe 主题里 primary-6 被改成近黑，链接蓝用设计色 #1664FF。 */}
        <span className="text-[11px] leading-4.25 text-[#1664FF]">{t("查看分镜")}</span>

        <span
          className="absolute right-[4px] top-[4px]"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {generating ? (
            <Tooltip content={t("分镜识别中，无法删除")} position="top">
              {removeBadge}
            </Tooltip>
          ) : (
            removeBadge
          )}
        </span>
      </div>
    </div>
  );
}
