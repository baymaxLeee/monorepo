import type { CanvasNode } from "@repo/api";
import { Button, toast } from "@repo/design-system";
import { useAtomValue } from "jotai";
import { Download, Film, History, LoaderCircle, Pause, Play, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useNodeMedia } from "../../hooks/useNodeMedia";
import { generationStatusAtom } from "../../store/generations";

export function PreviewPanel({
  canvasId,
  shot,
  nextShot,
  playing,
  canPlayAll,
  working,
  onEnded,
  onPause,
  onPlay,
  onPlayAll,
  onGenerate,
  onCancel,
  onHistory,
}: {
  canvasId: string;
  shot: CanvasNode | undefined;
  nextShot: CanvasNode | undefined;
  playing: boolean;
  canPlayAll: boolean;
  working: boolean;
  onEnded: () => void;
  onPause: () => void;
  onPlay: () => void;
  onPlayAll: () => void;
  onGenerate: () => void;
  onCancel: () => void;
  onHistory: () => void;
}) {
  const player = useRef<HTMLVideoElement>(null);
  const playbackIdentity = useRef("");
  const paused = useRef(onPause);
  paused.current = onPause;
  const media = useNodeMedia(canvasId, shot?.id, shot?.asset_id);
  const next = useNodeMedia(canvasId, nextShot?.id, nextShot?.asset_id);
  const state = useAtomValue(generationStatusAtom).get(shot?.id ?? "");
  const generating = state?.status === "queued" || state?.status === "running";
  const [ratio, setRatio] = useState<{ source: string; value: number } | null>(null);
  const [playbackFailed, setPlaybackFailed] = useState("");
  const [width, height] = (shot?.generation_config.aspect_ratio || "9:16").split(":").map(Number);
  const configuredRatio = width && height && width > 0 && height > 0 ? width / height : 9 / 16;
  const aspectRatio = ratio?.source === media.url ? ratio.value : configuredRatio;
  useLayoutEffect(() => {
    const video = player.current;
    if (!video || !media.url) return;
    if (!playing || generating) {
      video.pause();
      return;
    }
    let active = true;
    const identity = `${shot?.id}:${media.url}`;
    if (playbackIdentity.current !== identity || video.ended) video.currentTime = 0;
    playbackIdentity.current = identity;
    void video.play().catch((error: unknown) => {
      if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
      paused.current();
      toast.error("视频无法自动播放，请使用播放器重试");
    });
    return () => {
      active = false;
    };
  }, [media.url, playing, generating, shot?.id]);
  useEffect(() => {
    if (!next.url) return;
    const video = document.createElement("video");
    video.preload = "auto";
    video.src = next.url;
    video.load();
    return () => {
      video.removeAttribute("src");
      video.load();
    };
  }, [next.url]);
  return (
    <aside
      className="box-border flex w-[418px] max-w-[45%] min-h-0 shrink-0 flex-col items-center justify-center gap-3 border-l p-3"
      aria-label="分镜视频预览"
    >
      <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
        <div
          className="relative flex max-h-full w-full items-center justify-center overflow-hidden rounded-[20px] bg-muted"
          style={{ aspectRatio, maxWidth: `min(100%, ${aspectRatio * 60}vh)` }}
        >
          <video
            ref={player}
            src={media.url || undefined}
            controls={Boolean(media.url) && !generating}
            playsInline
            preload="metadata"
            className="size-full max-h-full object-contain"
            aria-label={shot?.name || "分镜视频"}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              if (video.videoWidth && video.videoHeight)
                setRatio({ source: media.url, value: video.videoWidth / video.videoHeight });
            }}
            onEnded={onEnded}
            onPlay={onPlay}
            onPause={(event) => {
              if (media.url && event.currentTarget.paused && !event.currentTarget.ended) onPause();
            }}
            onError={() => {
              if (media.url) {
                setPlaybackFailed(media.url);
                onPause();
              }
            }}
          />
          {!media.url || generating || playbackFailed === media.url ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-5 text-center text-sm text-muted-foreground">
              {generating || (shot?.asset_id && !media.failed && !media.url) ? (
                <LoaderCircle className="size-8 animate-spin" />
              ) : (
                <Film className="size-10" />
              )}
              <p>
                {generating
                  ? state?.cancel_requested
                    ? "正在停止生成…"
                    : "视频生成中…"
                  : media.failed || (media.url && playbackFailed === media.url)
                    ? "视频加载失败，可刷新重试"
                    : shot?.asset_id
                      ? "加载视频…"
                      : "视频预览"}
              </p>
              {generating ? (
                <Button size="sm" variant="outline" disabled={working || state?.cancel_requested} onClick={onCancel}>
                  <Square className="size-3" />
                  停止生成
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      {state?.status === "failed" ? (
        <p role="status" className="text-sm text-destructive">
          本次生成失败。已有视频仍保留，可在生成历史中查看详情。
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" disabled={!canPlayAll} onClick={playing ? onPause : onPlayAll}>
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          {playing ? "暂停" : "播放全部"}
        </Button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" disabled={!shot} onClick={onHistory} aria-label="生成历史">
            <History className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            disabled={!media.url || generating}
            aria-label="下载视频"
            onClick={() => {
              const link = document.createElement("a");
              link.href = media.url;
              link.download = `${shot?.name || "分镜"}.mp4`;
              link.click();
            }}
          >
            <Download className="size-4" />
          </Button>
          <Button size="sm" disabled={!shot?.prompt.trim() || working || generating} onClick={onGenerate}>
            生成视频
          </Button>
        </div>
      </div>
    </aside>
  );
}
