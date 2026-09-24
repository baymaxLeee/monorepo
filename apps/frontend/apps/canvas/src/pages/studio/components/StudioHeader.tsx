import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from "@repo/design-system";
import { useAtomValue } from "jotai";
import {
  History as IconAgentHistory,
  PackageOpen as IconBatchExport,
  ChevronLeft as IconLeft,
  Palette as IconCanvasMode,
  Presentation as IconStoryboardMode,
  Sparkles as IconWkfOptimization,
  MessageCircle as IconChat,
} from "lucide-react";

import { ActionButton } from "@/components/ActionButton";
import t from "@/utils/i18n";

import type { StudioView } from "../domain/types";
import { assetsPanelOpenAtom, studioViewAtom, studioViewChangingAtom } from "../store/index";

import styles from "./StudioHeader.module.less";

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
      className={`${styles.header} ${view === "canvas" ? styles.canvasHeader : styles.storyboardHeader} ${
        assetsOpen ? styles.headerWithAssets : styles.headerWithoutAssets
      }`}
    >
      <div className={styles.leading}>
        <div
          className={`${styles.project} ${
            assetsOpen
              ? `${styles.projectWithAssets} ${view === "canvas" ? styles.projectCanvas : ""}`
              : styles.projectWithoutAssets
          }`}
        >
          <Button
            variant="ghost"
            aria-label={t("返回剧集列表")}
            className={styles.backButton}
            onClick={onBack}
            type="button"
          >
            <IconLeft />
          </Button>
          <h1 className={styles.projectTitle}>{title}</h1>
        </div>
        <div className={styles.viewSwitch}>
          <Button
            variant="ghost"
            aria-label={view === "canvas" ? t("画布") : t("切换到画布")}
            className={`${styles.viewButton} ${view === "canvas" ? styles.activeViewButton : styles.idleViewButton}`}
            disabled={viewChanging}
            onClick={() => view !== "canvas" && onViewChange("canvas")}
            type="button"
          >
            <IconCanvasMode aria-hidden className={styles.viewIcon} strokeWidth={1.5} />
            {view === "canvas" ? t("画布") : null}
          </Button>
          <Button
            variant="ghost"
            aria-label={view === "storyboard" ? t("故事板") : t("切换到故事板")}
            className={`${styles.viewButton} ${
              view === "storyboard" ? styles.activeViewButton : styles.idleViewButton
            }`}
            disabled={viewChanging}
            onClick={() => view !== "storyboard" && onViewChange("storyboard")}
            type="button"
          >
            <IconStoryboardMode aria-hidden className={styles.viewIcon} strokeWidth={1.5} />
            {view === "storyboard" ? t("故事板") : null}
          </Button>
        </div>
      </div>

      <div className={styles.actions}>
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

        <AlertDialog>
          <AlertDialogTrigger
            disabled={!composable || composing}
            render={
              <ActionButton
                disabled={!composable}
                icon={<IconWkfOptimization />}
                loading={composing}
                paddingX={12}
                variant="primary"
              />
            }
          >
            {t("生成全部")}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("确认生成全部？")}</AlertDialogTitle>
              <AlertDialogDescription render={<div />} className="space-y-1">
                <p>{t("将一键发起{canvasLabel}下 {shotCount} 个分镜视频的生成任务。", { canvasLabel, shotCount })}</p>
                <p>{t("将按照每个分镜配置的参数进行生成，请确认已配置好相关模型参数。")}</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("取消")}</AlertDialogCancel>
              <AlertDialogAction onClick={onCompose}>{t("确认生成")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </header>
  );
}
