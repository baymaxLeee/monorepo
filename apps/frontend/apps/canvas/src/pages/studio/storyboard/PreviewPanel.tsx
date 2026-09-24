import { apiHttp } from "@repo/api";
import { toast, Tooltip, TooltipContent, TooltipTrigger, Button } from "@repo/design-system";
import {
  History as IconAgentHistory,
  Download as IconDownloadFine,
  LoaderCircle as IconLoading,
  Play as IconPlay,
  ArrowLeftRight as IconSwitchover,
} from "lucide-react";
import { type SyntheticEvent, useEffect, useLayoutEffect, useRef, useState } from "react";

import { ActionButton } from "@/components/ActionButton";
import { VideoPlayer } from "@/components/videoPlayer/index";
import t from "@/utils/i18n";

import { VideoGenerationFailure } from "../components/VideoGenerationFailure";
import type { Shot } from "../domain/types";

const PREVIEW_WIDTH = 394;
const DEFAULT_PREVIEW_RATIO = { height: 16, width: 9 };

interface PreviewRatio {
  height: number;
  width: number;
}

function configuredPreviewRatio(ratio?: string): PreviewRatio {
  const [width, height] = ratio?.split(":").map(Number) ?? [];
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { height, width };
  }
  return DEFAULT_PREVIEW_RATIO;
}

export function PreviewPanel({
  generatable,
  playAllEnabled,
  playing,
  nextVideoUrl,
  shot,
  onEnded,
  onGenerate,
  onOpenHistory,
  onPause,
  onPlay,
  onPlayAll,
  onStopGenerate,
  cancelDisabled = false,
  stoppingGeneration,
}: {
  cancelDisabled?: boolean;
  generatable: boolean;
  /** 只要有任意分镜视频已生成就能连播，不限于当前选中的这一个。 */
  playAllEnabled: boolean;
  playing: boolean;
  nextVideoUrl?: string;
  shot: Shot | undefined;
  onEnded: () => void;
  onGenerate: () => void;
  onOpenHistory: () => void;
  onPause: () => void;
  onPlay: () => void;
  onPlayAll: () => void;
  onStopGenerate: () => void;
  stoppingGeneration: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onPauseRef = useRef(onPause);
  useEffect(() => {
    onPauseRef.current = onPause;
  }, [onPause]);
  const [downloading, setDownloading] = useState(false);
  const [mediaRatio, setMediaRatio] = useState<(PreviewRatio & { source: string }) | undefined>();
  const generating = shot?.status === "generating";
  const failed = shot?.status === "failed";
  const failureReason = shot?.generationErrorMessage;
  const hasContent = shot?.status === "ready" && Boolean(shot.videoUrl || shot.thumbnail);
  const previewSource = shot?.videoUrl || shot?.thumbnail;
  const previewRatio =
    mediaRatio && mediaRatio.source === previewSource ? mediaRatio : configuredPreviewRatio(shot?.settings.ratio);

  const updateMediaRatio = (source: string | undefined, ratio: PreviewRatio) => {
    if (
      !source ||
      !Number.isFinite(ratio.width) ||
      !Number.isFinite(ratio.height) ||
      ratio.width <= 0 ||
      ratio.height <= 0
    ) {
      return;
    }
    setMediaRatio({ source, ...ratio });
  };

  const handleThumbnailLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    updateMediaRatio(shot?.thumbnail, {
      height: event.currentTarget.naturalHeight,
      width: event.currentTarget.naturalWidth,
    });
  };

  const handleVideoMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    updateMediaRatio(shot?.videoUrl, {
      height: event.currentTarget.videoHeight,
      width: event.currentTarget.videoWidth,
    });
  };

  // 在浏览器派发切源的 pause 事件前同步恢复播放意图。
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (generating) {
      video.pause();
      video.currentTime = 0;
      return;
    }
    if (playing) {
      let active = true;
      // 相邻节点可能选用了同一视频；复用元素时也必须从头播放。
      if (video.ended) video.currentTime = 0;
      void video.play().catch((error: unknown) => {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }
        onPauseRef.current();
        toast.add({
          type: "error",
          title: t("视频无法自动播放，请使用播放器重试"),
        });
      });
      return () => {
        active = false;
      };
    } else {
      video.pause();
    }
    return undefined;
  }, [generating, playing, shot?.id, shot?.selectedOutputId, shot?.videoUrl]);

  useEffect(() => {
    if (!nextVideoUrl) return;
    // 只预加载紧邻的下一段，实际播放始终使用 videoRef 的同一个元素。
    const preload = document.createElement("video");
    preload.preload = "auto";
    preload.src = nextVideoUrl;
    preload.load();
    return () => {
      preload.removeAttribute("src");
      preload.load();
    };
  }, [nextVideoUrl]);

  const downloadVideo = async () => {
    const videoUrl = shot?.videoUrl;
    if (!videoUrl || generating || downloading) {
      return;
    }
    setDownloading(true);
    try {
      const blob = (await apiHttp.get<Blob>(videoUrl, { responseType: "blob" })).data;
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${shot?.id ?? "shot"}.mp4`;
      link.click();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <aside className="box-border flex w-[418px] min-h-0 shrink-0 flex-col items-center justify-center border-0 border-l border-solid border-border p-3">
      <div
        className="relative max-w-[394px] min-h-0 shrink grow-0 overflow-hidden rounded-[20px] bg-muted"
        data-testid="storyboard-preview-frame"
        style={{
          aspectRatio: `${previewRatio.width} / ${previewRatio.height}`,
          flexBasis: `${(PREVIEW_WIDTH * previewRatio.height) / previewRatio.width}px`,
        }}
      >
        {generating ? (
          <>
            {shot.videoUrl ? (
              <VideoPlayer
                className="h-full w-full"
                controls={false}
                key={shot.selectedOutputId ?? shot.videoUrl}
                onLoadedMetadata={handleVideoMetadata}
                ref={videoRef}
                src={shot.videoUrl}
              />
            ) : null}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[rgba(0,0,0,0.5)] text-[14px] leading-6 text-white">
              <span className="flex h-10 w-10 items-center justify-center">
                <IconLoading aria-hidden className="animate-spin" fontSize={34} />
              </span>
              {t("视频生成中，请稍后...")}
              {cancelDisabled ? (
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex max-w-full" />}>
                    <span>
                      <Button
                        variant="ghost"
                        className="cursor-pointer border-0 bg-[transparent] p-0 text-[13px] leading-5.5 text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        disabled
                        type="button"
                      >
                        {t("终止生成")}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side={"top"}>{t("视频已开始生成，无法取消")}</TooltipContent>
                </Tooltip>
              ) : (
                <Button
                  variant="ghost"
                  className="cursor-pointer border-0 bg-[transparent] p-0 text-[13px] leading-5.5 text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={stoppingGeneration}
                  onClick={onStopGenerate}
                  type="button"
                >
                  {t("终止生成")}
                </Button>
              )}
            </div>
          </>
        ) : failed ? (
          <VideoGenerationFailure
            errorMessage={failureReason}
            onRetry={onGenerate}
            seedanceTaskId={shot.generationSeedanceTaskId}
            requestId={shot.generationRequestId}
            retryDisabled={!generatable}
          />
        ) : hasContent ? (
          <>
            {shot?.videoUrl ? (
              <VideoPlayer
                className="h-full w-full"
                onEnded={onEnded}
                onError={() => {
                  onPause();
                  toast.add({
                    type: "error",
                    title: t("视频加载失败，请使用播放器重试或选择其他分镜"),
                  });
                }}
                onLoadedMetadata={handleVideoMetadata}
                onPause={(event) => {
                  // load() 切源和旧媒体结束可能排队发送 pause；以元素当前状态为准。
                  if (event.currentTarget.paused && !event.currentTarget.ended) {
                    onPause();
                  }
                }}
                onPlay={onPlay}
                ref={videoRef}
                src={shot.videoUrl}
              />
            ) : (
              <img
                alt={t("当前分镜预览")}
                className="h-full w-full object-cover"
                onLoad={handleThumbnailLoad}
                src={shot?.thumbnail}
              />
            )}
          </>
        ) : (
          <Button
            variant="ghost"
            className={`flex h-full w-full flex-col items-center justify-center gap-3 border-0 bg-[transparent] p-0 text-[14px] leading-6 text-muted-foreground ${
              generatable ? "cursor-pointer" : "cursor-not-allowed"
            }`}
            disabled={!generatable}
            onClick={onGenerate}
            type="button"
          >
            <span
              aria-hidden
              className="flex size-[72px] items-center justify-center rounded-[20px] border border-dashed border-muted-foreground/40 text-muted-foreground"
            >
              <IconPlay className="ml-1 size-8" strokeWidth={1.5} />
            </span>
            <span>
              {t("未生成内容，")}
              <span className="text-foreground">{t("立即生成")}</span>
            </span>
          </Button>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3 py-3">
        <ActionButton
          disabled={generating || failed || !shot?.videoUrl || downloading}
          icon={<IconDownloadFine />}
          onClick={() => {
            void downloadVideo();
          }}
          paddingX={12}
          size={28}
        >
          {t("下载")}
        </ActionButton>
        <ActionButton disabled={!playAllEnabled} icon={<IconSwitchover />} onClick={onPlayAll} paddingX={12} size={28}>
          {t("播放全部")}
        </ActionButton>
        <ActionButton disabled={!shot} icon={<IconAgentHistory />} onClick={onOpenHistory} paddingX={12} size={28}>
          {t("生成记录")}
        </ActionButton>
      </div>
    </aside>
  );
}
