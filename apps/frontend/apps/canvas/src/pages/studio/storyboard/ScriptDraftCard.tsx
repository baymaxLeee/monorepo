import { Tooltip, TooltipContent, TooltipTrigger, Button } from "@repo/design-system";
import {
  CircleCheck as IconCheckCircleFill,
  CircleX as IconCloseCircleFill,
  X as IconClose,
  LoaderCircle as IconLoading,
} from "lucide-react";

import t from "@/utils/i18n";

import styles from "./ScriptDraftCard.module.less";

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
    <Button
      variant="ghost"
      aria-label={generating ? t("分镜识别中，无法删除") : t("关闭分镜脚本草稿")}
      className={`${styles.dismissButton} ${generating ? styles.dismissButtonDisabled : ""}`}
      onClick={(event) => {
        event.stopPropagation();
        if (!generating) {
          onDismiss();
        }
      }}
      onKeyDown={(event) => event.stopPropagation()}
      type="button"
    >
      <IconClose />
    </Button>
  );

  return (
    <div className={styles.card}>
      <Button
        aria-label={generating ? t("分镜脚本生成中") : t("查看分镜脚本")}
        className={styles.surface}
        onClick={onOpen}
        type="button"
        variant="ghost"
      >
        {generating ? (
          <IconLoading aria-hidden className={styles.loadingIcon} />
        ) : status === "failed" ? (
          <IconCloseCircleFill aria-hidden className={styles.failedIcon} />
        ) : (
          <IconCheckCircleFill aria-hidden className={styles.successIcon} />
        )}
        <span className={styles.status}>
          {generating ? t("分镜脚本生成中") : status === "failed" ? t("分镜脚本生成失败") : t("分镜脚本已生成")}
        </span>
        {/* 分镜入口保留产品蓝色，避免被中性的全局 primary 吞掉层级。 */}
        <span className={styles.openLabel}>{t("查看分镜")}</span>
      </Button>
      <span className={styles.dismiss}>
        {generating ? (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex max-w-full" />}>{removeBadge}</TooltipTrigger>
            <TooltipContent side={"top"}>{t("分镜识别中，无法删除")}</TooltipContent>
          </Tooltip>
        ) : (
          removeBadge
        )}
      </span>
    </div>
  );
}
