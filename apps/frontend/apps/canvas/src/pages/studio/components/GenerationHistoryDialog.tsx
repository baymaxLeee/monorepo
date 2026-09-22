import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@repo/design-system";
import { useAtomValue } from "jotai";
import {
  Check as IconCheck,
  Download as IconDownloadFine,
  ChevronLeft as IconLeft,
  LoaderCircle as IconLoading,
  FileText as IconText,
  Video as IconVideo,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { ActionButton } from "@/components/ActionButton";
import { Tooltip } from "@/components/ui";
import { VideoPlayer } from "@/components/videoPlayer/index";
import { canvasnode } from "@/domain";
import t from "@/utils/i18n";

import { listCanvasNodeHistories } from "../domain/actions";
import { shotChipLabel } from "../domain/model";
import type { GenerationHistoryItem } from "../domain/types";
import { videoModelLabel } from "../domain/videoModels";
import { imageModelsAtom, textModelsAtom, videoModelsAtom } from "../store/index";
import { VideoGenerationFailure } from "./VideoGenerationFailure";

import styles from "./GenerationHistoryDialog.module.less";

function MetaDivider() {
  return <span className="h-3 w-[1px] shrink-0 bg-border" />;
}

function formatHistoryTime(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function durationLabel(duration: string) {
  if (duration === "-1s") return t("时长 自动");
  const seconds = duration.trim().replace(/\s*(?:s|秒)$/iu, "");
  return seconds ? t("时长 {seconds} 秒", { seconds }) : "-";
}

function plainHistoryScript(script?: string) {
  const value = script?.trim();
  if (!value) return "-";
  const fenced = value.match(/^```(?:plain|plaintext|text)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/iu);
  return fenced?.[1] ?? value;
}

function HistoryThumb({ item }: { item: GenerationHistoryItem }) {
  const isImage = item.type === canvasnode.CanvasNodeType.IMAGE_GENERATION;
  const isText = item.type === canvasnode.CanvasNodeType.TEXT_GENERATION;
  const thumbnailURL = item.status === "succeeded" ? item.firstFrameUrl : undefined;
  const thumbnailErrorCode = undefined;
  const thumbnailErrorMessage = undefined;

  if (item.status === "failed" || item.status === "cancelled") {
    return (
      <Tooltip
        content={item.errorMessage || t(isText ? "文本生成失败" : isImage ? "图片生成失败" : "视频生成失败")}
        position="top"
      >
        <div className="flex h-[47px] w-[84px] shrink-0 flex-col items-center justify-center rounded-[8px] bg-[rgba(215,49,42,0.1)]">
          <span className="text-[12px] font-medium leading-3 text-destructive">?</span>
          <span className="text-[12px] font-medium leading-5 text-destructive">
            {item.status === "cancelled" ? t("已取消") : t("生成失败")}
          </span>
        </div>
      </Tooltip>
    );
  }

  if (item.status === "running") {
    return (
      <div className="flex h-[47px] w-[84px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[8px] bg-muted">
        <IconLoading />
        <span className="text-center text-[10px] font-medium leading-3 text-muted-foreground">{t("生成中")}</span>
      </div>
    );
  }
  if (isText) {
    return (
      <div className="flex h-[47px] w-[84px] shrink-0 items-center justify-center rounded-[8px] bg-muted text-[24px] text-muted-foreground">
        <IconText aria-hidden />
      </div>
    );
  }
  if (isImage) {
    return item.videoUrl ? (
      <img alt={t("生成图片")} className="h-[47px] w-[84px] shrink-0 rounded-[8px] object-cover" src={item.videoUrl} />
    ) : (
      <div className="flex h-[47px] w-[84px] shrink-0 items-center justify-center rounded-[8px] bg-muted text-[10px] text-muted-foreground">
        {t("暂无图片")}
      </div>
    );
  }

  return (
    <div
      className="relative flex h-[47px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-muted text-muted-foreground"
      title={thumbnailErrorMessage ?? thumbnailErrorCode}
    >
      {thumbnailURL ? (
        <img alt={t("视频首帧")} className="h-full w-full object-cover" src={thumbnailURL} />
      ) : (
        <IconVideo className="text-[32px]" />
      )}
      <span className="absolute bottom-1 left-1 rounded-[8px] bg-[rgba(0,0,0,0.5)] px-1.5 py-[2px] text-[10px] font-medium leading-2.75 text-white">
        {item.duration === "-1s" ? t("自动") : item.duration}
      </span>
    </div>
  );
}

function HistoryRow({
  item,
  number,
  selected,
  onSelect,
}: {
  item: GenerationHistoryItem;
  number: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const summary =
    item.type === canvasnode.CanvasNodeType.TEXT_GENERATION
      ? plainHistoryScript(item.outputText || item.script)
      : plainHistoryScript(item.script);
  return (
    <div className="flex h-[63px] w-full shrink-0 items-center gap-1">
      <div className="flex w-[18px] shrink-0 items-center justify-center text-[13px] font-medium leading-6 text-muted-foreground">
        {selected ? <span className={styles.selectedMarker} /> : number}
      </div>
      <button
        aria-pressed={selected}
        className={`${styles.historyRow} ${selected ? styles.historyRowSelected : ""}`}
        onClick={onSelect}
        type="button"
      >
        <HistoryThumb item={item} />
        <p className="m-0 line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap wrap-break-word text-[13px] leading-5.5 text-foreground">
          {summary}
        </p>
      </button>
    </div>
  );
}

function SelectedHistoryDetail({
  alreadySelected,
  item,
  modelLabel,
  number,
  selecting,
  shotIndex,
  onSelectHistory,
}: {
  alreadySelected: boolean;
  item?: GenerationHistoryItem;
  modelLabel: string;
  number: number;
  selecting?: boolean;
  shotIndex: number;
  onSelectHistory: (item: GenerationHistoryItem) => void;
}) {
  const [scriptExpanded, setScriptExpanded] = useState(false);
  const [scriptOverflow, setScriptOverflow] = useState(false);
  const scriptRef = useRef<HTMLParagraphElement>(null);
  const script = plainHistoryScript(item?.script);
  const isImage = item?.type === canvasnode.CanvasNodeType.IMAGE_GENERATION;
  const isText = item?.type === canvasnode.CanvasNodeType.TEXT_GENERATION;
  const canUse = item?.status === "succeeded" && Boolean(isText ? item.outputText : item.videoUrl);

  useEffect(() => setScriptExpanded(false), [item?.id]);
  useLayoutEffect(() => {
    const element = scriptRef.current;
    if (!element) return;
    const measure = () => setScriptOverflow(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [script]);

  return (
    <section className={styles.previewPane}>
      {item?.status === "failed" && !isImage ? (
        <div className={`${styles.videoFrame} ${styles.videoFrameFailure}`}>
          <VideoGenerationFailure
            errorMessage={item.errorMessage}
            seedanceTaskId={isText ? undefined : item.seedanceTaskId}
            requestId={item.id}
            title={isText ? t("文本生成失败") : undefined}
          />
        </div>
      ) : isText ? (
        <div className={styles.textFrame}>
          {item?.status === "succeeded" && item.outputText ? (
            <p>{item.outputText}</p>
          ) : (
            <span>{t("暂无可预览文本")}</span>
          )}
        </div>
      ) : isImage ? (
        <div className={`${styles.videoFrame} flex items-center justify-center overflow-hidden`}>
          {item?.videoUrl ? (
            <img alt={t("生成图片")} className="h-full w-full object-contain" src={item.videoUrl} />
          ) : (
            t("暂无可预览图片")
          )}
        </div>
      ) : (
        <VideoPlayer
          className={styles.videoFrame}
          empty={
            <div className="flex h-full items-center justify-center text-[14px] text-muted-foreground">
              {t("暂无可预览视频")}
            </div>
          }
          src={item?.status === "succeeded" ? item.videoUrl : undefined}
        />
      )}

      <div className="flex min-w-0 items-start justify-between gap-5">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-4 text-[20px] font-medium leading-7 text-foreground">
            <span className="shrink-0">{t("生成记录{number}", { number })}</span>
            {item ? <span className="truncate">{formatHistoryTime(item.completedAt ?? item.createdAt)}</span> : null}
          </div>
          {item ? (
            <div className="flex items-center gap-2 text-[13px] leading-5.5 text-foreground">
              <span className="max-w-[240px] truncate">{modelLabel}</span>
              {item.resolution ? (
                <>
                  <MetaDivider />
                  <span>{item.resolution}</span>
                </>
              ) : null}
              {item.duration ? (
                <>
                  <MetaDivider />
                  <span>{durationLabel(item.duration)}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {!isText ? (
            <ActionButton
              disabled={!canUse}
              icon={<IconDownloadFine />}
              onClick={() => {
                if (!item?.videoUrl) return;
                const link = document.createElement("a");
                link.href = item.videoUrl;
                link.download = `${shotChipLabel(shotIndex)}-${item.id}.${isImage ? "png" : "mp4"}`;
                link.target = "_blank";
                link.rel = "noreferrer";
                link.click();
              }}
              paddingX={12}
              size={32}
            >
              {t("下载")}
            </ActionButton>
          ) : null}
          <ActionButton
            disabled={!canUse || alreadySelected || selecting}
            icon={<IconCheck />}
            onClick={() => item && onSelectHistory(item)}
            paddingX={12}
            size={32}
            variant="primary"
          >
            {alreadySelected ? t("当前使用中") : t(isText ? "选用此文本" : isImage ? "选用此图片" : "选用此视频")}
          </ActionButton>
        </div>
      </div>

      <div className={`${styles.scriptPanel} ${scriptExpanded ? styles.scriptPanelExpanded : ""}`}>
        <p className={`${styles.scriptText} ${scriptExpanded ? styles.scriptTextExpanded : ""}`} ref={scriptRef}>
          {script}
        </p>
        {item?.script && (scriptOverflow || scriptExpanded) ? (
          <button className={styles.scriptToggle} onClick={() => setScriptExpanded((value) => !value)} type="button">
            {scriptExpanded ? t("收起") : t("更多")}
          </button>
        ) : null}
      </div>
    </section>
  );
}

export function GenerationHistoryDialog({
  currentHistoryId,
  canvasId,
  canvasTitle,
  projectId,
  canvasnodeId,
  selecting,
  shotIndex,
  visible,
  onCancel,
  onSelectHistory,
}: {
  currentHistoryId?: string;
  canvasId: string;
  canvasTitle?: string;
  projectId: string;
  canvasnodeId?: string;
  selecting?: boolean;
  shotIndex: number;
  visible: boolean;
  onCancel: () => void;
  onSelectHistory: (item: GenerationHistoryItem) => void;
}) {
  const [items, setItems] = useState<GenerationHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const imageModels = useAtomValue(imageModelsAtom);
  const textModels = useAtomValue(textModelsAtom);
  const videoModels = useAtomValue(videoModelsAtom);

  useEffect(() => {
    if (!visible || !canvasnodeId) return;
    let active = true;
    setLoading(true);
    setItems([]);
    setSelectedId("");
    listCanvasNodeHistories(projectId, canvasId, canvasnodeId)
      .then((next) => {
        if (!active) return;
        setItems(next);
        setSelectedId(next[0]?.id ?? "");
      })
      .catch(() => {
        if (active) {
          setItems([]);
          setSelectedId("");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [currentHistoryId, canvasId, projectId, canvasnodeId, visible]);

  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.id === selectedId),
  );
  const selected = items[selectedIndex];
  const selectedNumber = items.length - selectedIndex;
  const displayTitle = canvasTitle || shotChipLabel(shotIndex);
  const selectedModelOptions =
    selected?.type === canvasnode.CanvasNodeType.IMAGE_GENERATION
      ? imageModels
      : selected?.type === canvasnode.CanvasNodeType.TEXT_GENERATION
        ? textModels
        : videoModels;

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent
        className={`canvas-web-theme canvas-modal flex max-h-[90dvh] w-[520px] flex-col gap-0 p-0 sm:max-w-none ${styles.dialog}`}
        style={{ maxWidth: "92vw" }}
      >
        <DialogHeader className="canvas-modal-header shrink-0 px-6 py-5">
          <DialogTitle className="canvas-modal-title">
            <div className="flex min-w-0 items-center gap-4">
              <button
                aria-label={t("返回")}
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[8px] border border-solid border-border bg-white p-0 text-[14px] text-foreground hover:bg-background"
                onClick={onCancel}
                type="button"
              >
                <IconLeft />
              </button>
              <span className="max-w-[320px] truncate text-[14px] font-medium leading-6 text-foreground">
                {displayTitle}
              </span>
            </div>
          </DialogTitle>
          <DialogDescription className="sr-only">{t("查看并选择历史生成结果")}</DialogDescription>
        </DialogHeader>
        <div className="canvas-modal-content min-h-0 overflow-auto px-6 py-5">
          <div className={styles.dialogBody}>
            <SelectedHistoryDetail
              alreadySelected={selected?.id === currentHistoryId}
              item={selected}
              modelLabel={selected ? videoModelLabel(selected.model, selectedModelOptions) : "-"}
              number={selectedNumber}
              onSelectHistory={onSelectHistory}
              selecting={selecting}
              shotIndex={shotIndex}
            />

            <aside className={styles.historyPanel}>
              <div className="flex shrink-0 items-center gap-4">
                <h2 className="m-0 text-[18px] font-medium leading-6.5 text-foreground">
                  {t("{shot} 生成历史", { shot: displayTitle })}
                </h2>
                <span className="text-[13px] leading-5.5 text-muted-foreground">
                  {t("共 {count} 个记录", { count: items.length })}
                </span>
              </div>
              <div className={styles.historyList}>
                {loading ? (
                  <div className="flex h-[240px] items-center justify-center">
                    <IconLoading fontSize={20} />
                  </div>
                ) : items.length === 0 ? (
                  <div className="flex h-[240px] items-center justify-center text-[14px] text-muted-foreground">
                    {t("暂无生成记录")}
                  </div>
                ) : (
                  items.map((item, index) => (
                    <HistoryRow
                      item={item}
                      key={item.id}
                      number={items.length - index}
                      onSelect={() => setSelectedId(item.id)}
                      selected={item.id === selected?.id}
                    />
                  ))
                )}
              </div>
            </aside>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
