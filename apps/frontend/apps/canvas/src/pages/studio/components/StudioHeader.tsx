import { useAtomValue } from "jotai";
import {
  History as IconAgentHistory,
  PackageOpen as IconBatchExport,
  ChevronLeft as IconLeft,
  Sparkles as IconWkfOptimization,
  MessageCircle as IconChat,
} from "lucide-react";

import canvasModeIcon from "@/assets/canvas/canvas-mode.svg";
import storyboardModeIcon from "@/assets/canvas/storyboard-mode.svg";
import { ActionButton } from "@/components/ActionButton";
import { Popconfirm } from "@/components/ui";
import t from "@/utils/i18n";

import type { StudioView } from "../domain/types";
import { assetsPanelOpenAtom, studioViewAtom, studioViewChangingAtom } from "../store/index";

export function StudioHeader({
  composable,
  composing = false,
  canvasLabel,
  exportable,
  exporting = false,
  shotCount,
  title,
  onBack,
  onCompose,
  onExport,
  onOpenExportHistory,
  onToggleChat,
  chatOpen = false,
  onViewChange = () => undefined,
}: {
  composable: boolean;
  composing?: boolean;
  canvasLabel: string;
  exportable: boolean;
  exporting?: boolean;
  shotCount: number;
  title: string;
  onBack: () => void;
  onCompose: () => void;
  onExport: () => void;
  onOpenExportHistory: () => void;
  onToggleChat: () => void;
  chatOpen?: boolean;
  onViewChange?: (view: StudioView) => void;
}) {
  const assetsOpen = useAtomValue(assetsPanelOpenAtom);
  const view = useAtomValue(studioViewAtom);
  const viewChanging = useAtomValue(studioViewChangingAtom);
  return (
    <header
      className={`flex h-[48px] shrink-0 items-center justify-between ${
        view === "canvas"
          ? "absolute inset-x-0 top-0 z-20 border-0 bg-[transparent]"
          : "border-0 border-b border-solid border-border bg-white"
      } ${assetsOpen ? "pl-0 pr-5" : "px-5"}`}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div
          className={`flex min-w-0 items-center gap-4 ${
            assetsOpen
              ? `box-border h-[48px] w-[300px] shrink-0 px-5 ${
                  view === "canvas" ? "border-0 border-b border-r border-solid border-border bg-white" : ""
                }`
              : ""
          }`}
        >
          <button
            aria-label={t("返回剧集列表")}
            className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-solid border-border bg-white p-0 text-[14px] text-foreground hover:bg-background"
            onClick={onBack}
            type="button"
          >
            <IconLeft />
          </button>
          <h1 className="m-0 min-w-0 max-w-[240px] flex-1 truncate text-[14px] font-medium leading-6 text-foreground">
            {title}
          </h1>
        </div>
        <div className="flex h-8 items-center gap-1 rounded-[8px] bg-[color-mix(in_srgb,#f6f6f6_70%,transparent)] px-1 py-0.75 backdrop-blur-[16px]">
          <button
            aria-label={view === "canvas" ? t("画布") : t("切换到画布")}
            className={`flex h-6 items-center justify-center gap-1 rounded-[6px] border-0 p-0 text-[12px] font-medium text-foreground ${
              view === "canvas"
                ? "cursor-default bg-white px-2 shadow-[0_1px_2px_rgba(0,0,0,0.07),0_0.5px_1px_rgba(0,0,0,0.05),0_0_0_0.5px_rgba(213,219,227,0.7)]"
                : "w-6 cursor-pointer bg-transparent hover:bg-[rgba(26,27,30,0.05)]"
            }`}
            disabled={viewChanging}
            onClick={() => view !== "canvas" && onViewChange("canvas")}
            type="button"
          >
            <img alt="" className="block h-4 w-4 shrink-0" src={canvasModeIcon} />
            {view === "canvas" ? t("画布") : null}
          </button>
          <button
            aria-label={view === "storyboard" ? t("故事板") : t("切换到故事板")}
            className={`flex h-6 items-center justify-center gap-1 rounded-[6px] border-0 p-0 text-[12px] font-medium text-foreground ${
              view === "storyboard"
                ? "cursor-default bg-white px-2 shadow-[0_1px_2px_rgba(0,0,0,0.07),0_0.5px_1px_rgba(0,0,0,0.05),0_0_0_0.5px_rgba(213,219,227,0.7)]"
                : "w-6 cursor-pointer bg-transparent hover:bg-[rgba(26,27,30,0.05)]"
            }`}
            disabled={viewChanging}
            onClick={() => view !== "storyboard" && onViewChange("storyboard")}
            type="button"
          >
            <img alt="" className="block h-4 w-4" src={storyboardModeIcon} />
            {view === "storyboard" ? t("故事板") : null}
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {view === "canvas" ? (
          <ActionButton
            icon={<IconChat />}
            onClick={onToggleChat}
            paddingX={12}
            variant={chatOpen ? "primary" : undefined}
          >
            {t("AI 助手")}
          </ActionButton>
        ) : null}

        <ActionButton icon={<IconAgentHistory />} onClick={onOpenExportHistory} paddingX={12}>
          {t("导出记录")}
        </ActionButton>

        <ActionButton
          disabled={!exportable || exporting}
          icon={<IconBatchExport />}
          loading={exporting}
          onClick={onExport}
          paddingX={12}
        >
          {t("批量导出")}
        </ActionButton>

        <Popconfirm
          content={
            <span className="block w-[268px] text-[13px] leading-5.5 text-foreground">
              {t("将一键发起{canvasLabel}下 {shotCount} 个分镜视频的生成任务。", { canvasLabel, shotCount })}
              <br />
              {t("将按照每个分镜配置的参数进行生成，请确认已配置好相关模型参数。")}
            </span>
          }
          disabled={!composable || composing}
          onOk={onCompose}
          position="br"
          title={t("确认生成全部？")}
        >
          <ActionButton
            disabled={!composable}
            icon={<IconWkfOptimization />}
            loading={composing}
            paddingX={12}
            variant="primary"
          >
            {t("生成全部")}
          </ActionButton>
        </Popconfirm>
      </div>
    </header>
  );
}
