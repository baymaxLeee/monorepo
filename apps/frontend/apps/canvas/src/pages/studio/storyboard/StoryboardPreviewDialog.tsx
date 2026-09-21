import { ChevronDown as IconDown } from "lucide-react";
import { useEffect, useState } from "react";

import emptyIllustration from "@/assets/storyboard-empty.png";
import { ActionButton } from "@/components/ActionButton";
import { Modal, Tooltip } from "@/components/ui";
import { HIDDEN_SCROLLBAR_CLASS, HIDDEN_SCROLLBAR_STYLE } from "@/hooks/useHorizontalScrollFade";
import t from "@/utils/i18n";

import { shotLabel } from "../domain/model";
import type { Shot } from "../domain/types";
import { DraftScriptPreview } from "./DraftScriptPreview";

import modalSizing from "@/components/ModalSizing.module.less";

function ShotNavItem({ active, label, onClick }: { active: boolean; label: string; onClick?: () => void }) {
  return (
    <button
      className={`flex w-[120px] items-center justify-between rounded-[8px] border-0 px-3 py-1.25 text-[13px] leading-5.5 tracking-[0.039px] ${
        active
          ? "bg-[rgba(26,27,30,0.05)] font-medium text-[color:var(--color-text-1)]"
          : "bg-white font-normal text-[color:var(--color-text-1)]"
      } ${onClick ? "cursor-pointer" : "cursor-default"}`}
      onClick={onClick}
      type="button"
    >
      <span className="truncate">{label}</span>
      <IconDown className="shrink-0 rotate-[-90deg] text-[12px] text-[color:var(--color-text-3)]" />
    </button>
  );
}

function ShotNavSkeleton() {
  return (
    <div
      aria-hidden
      className="h-[32px] w-[120px] shrink-0 rounded-[8px] bg-[linear-gradient(90deg,rgba(114,119,132,0.05)_0%,rgba(26,27,30,0)_100%)]"
    />
  );
}

export function StoryboardPreviewDialog({
  confirming,
  generating,
  status,
  shots,
  visible,
  onAdopt,
  onDiscard,
  onMinimize,
  onTerminate,
}: {
  confirming: boolean;
  generating: boolean;
  status: "running" | "completed" | "failed";
  shots: Shot[];
  visible: boolean;
  onAdopt: (shots: Shot[]) => void | Promise<void>;
  onDiscard: (shots: Shot[]) => void;
  /** 右上角关闭：不取消 SSE，缩到时间轴草稿卡片。 */
  onMinimize: () => void;
  onTerminate: () => void;
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draftShots, setDraftShots] = useState<Shot[]>([]);
  const selected = draftShots[selectedIndex];
  const hasShots = draftShots.length > 0;
  const adoptDisabled = confirming || generating || status !== "completed" || !hasShots;

  useEffect(() => {
    if (!visible) {
      return;
    }
    setDraftShots(shots);
    setSelectedIndex((current) => Math.min(current, Math.max(0, shots.length - 1)));
  }, [visible, shots]);

  const handleCancel = () => {
    if (confirming) {
      return;
    }
    onMinimize();
  };

  return (
    <Modal
      footer={null}
      maskClosable={!confirming}
      onCancel={handleCancel}
      className={modalSizing.storyboard}
      title={
        <span className="text-[18px] font-medium leading-6.5 tracking-[0.054px] text-[#1a2233]">{t("分镜预览")}</span>
      }
      visible={visible}
    >
      <div className={`${modalSizing.storyboardBody} flex gap-2`}>
        <div
          className={`flex w-[120px] shrink-0 flex-col gap-1 overflow-y-auto ${HIDDEN_SCROLLBAR_CLASS}`}
          style={HIDDEN_SCROLLBAR_STYLE}
        >
          {hasShots ? (
            draftShots.map((shot, index) => (
              <ShotNavItem
                active={index === selectedIndex}
                key={shot.id}
                label={shot.name || shotLabel(index)}
                onClick={() => setSelectedIndex(index)}
              />
            ))
          ) : (
            // 尚无推送：左侧占位「分镜 1」，右侧居中 empty 图。
            <ShotNavItem active label={shotLabel(0)} />
          )}
          {/* 总数未知：生成中始终保留骨架占位，每推送一个分镜就在上方追加。 */}
          {generating ? <ShotNavSkeleton /> : null}
        </div>

        <div className="w-[1px] shrink-0 self-stretch bg-[color:var(--color-border-3)]" />

        {selected ? (
          <div className="flex min-w-0 flex-1 flex-col items-start justify-start gap-2.5 overflow-y-auto px-3">
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-medium leading-5.5 tracking-[0.039px] text-[color:var(--color-text-1)]">
                {t("时长：")}
              </span>
              <span className="text-[12px] leading-5.5 text-[color:var(--color-text-2)]">
                {selected.duration || "-"}
              </span>
            </div>
            <div className="flex w-full min-h-0 flex-1 flex-col items-start gap-1">
              <span className="text-[13px] font-medium leading-5.5 tracking-[0.039px] text-[color:var(--color-text-1)]">
                {t("分镜脚本：")}
              </span>
              <DraftScriptPreview references={selected.assetReferences ?? []} script={selected.script || "-"} />
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-2.5 px-3">
            <img alt="" className="h-[200px] w-[222px] shrink-0 object-contain" src={emptyIllustration} />
            {generating ? (
              <p className="m-0 text-[16px] leading-5.5 tracking-[0.048px] text-[color:var(--color-text-2)]">
                {t("分镜生成中，请稍后...")}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-5 flex items-center justify-end">
        {generating && !hasShots ? (
          <ActionButton onClick={onTerminate}>{t("终止")}</ActionButton>
        ) : (
          <div className="flex items-center gap-3">
            <ActionButton disabled={confirming} onClick={() => (generating ? onTerminate() : onDiscard(draftShots))}>
              {t("放弃")}
            </ActionButton>
            {generating || status === "failed" ? (
              <Tooltip
                content={generating ? t("请先等待全部分镜生成") : t("分镜生成失败，请放弃后重新生成")}
                position="top"
              >
                <span className="inline-flex">
                  <ActionButton disabled variant="primary">
                    {t("采纳")}
                  </ActionButton>
                </span>
              </Tooltip>
            ) : (
              <ActionButton
                disabled={adoptDisabled}
                loading={confirming}
                onClick={() => void onAdopt(draftShots)}
                variant="primary"
              >
                {t("采纳")}
              </ActionButton>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
