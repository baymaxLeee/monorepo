import {
  type CSSProperties,
  type ForwardedRef,
  type ReactNode,
  type VideoHTMLAttributes,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
} from "react";

import styles from "./index.module.less";

type VideoPlayerProps = {
  className?: string;
  controls?: boolean;
  /** 无 src 时的占位内容；不传则渲染空容器。 */
  empty?: ReactNode;
  poster?: string;
  src?: string;
  style?: CSSProperties;
  videoClassName?: string;
  onEnded?: VideoHTMLAttributes<HTMLVideoElement>["onEnded"];
  onError?: VideoHTMLAttributes<HTMLVideoElement>["onError"];
  onLoadedMetadata?: VideoHTMLAttributes<HTMLVideoElement>["onLoadedMetadata"];
  onPause?: VideoHTMLAttributes<HTMLVideoElement>["onPause"];
  onPlay?: VideoHTMLAttributes<HTMLVideoElement>["onPlay"];
};

const assignRef = <T,>(ref: ForwardedRef<T>, value: T | null) => {
  if (typeof ref === "function") {
    ref(value);
  } else if (ref) {
    ref.current = value;
  }
};

/**
 * 统一视频播放器：完全使用浏览器原生控制条，不裁剪原生能力、不定制控件样式。
 * 默认样式适配资产预览（16:9）；视频始终按原始比例完整展示，容器允许留白。
 */
export const VideoPlayer = forwardRef<HTMLVideoElement, VideoPlayerProps>(function VideoPlayer(
  {
    className,
    controls = true,
    empty,
    poster,
    src,
    style,
    videoClassName,
    onEnded,
    onError,
    onLoadedMetadata,
    onPause,
    onPlay,
  },
  ref,
) {
  const captionsTrackRef = useRef<TextTrack | null>(null);

  const setVideoRef = useCallback(
    (video: HTMLVideoElement | null) => {
      assignRef(ref, video);

      if (!video) {
        captionsTrackRef.current = null;
        return;
      }

      // A programmatic track cannot fail a VTT request and disappear from native controls.
      captionsTrackRef.current ??= video.addTextTrack("captions");
    },
    [ref],
  );

  useEffect(() => {
    if (captionsTrackRef.current) {
      captionsTrackRef.current.mode = "disabled";
    }
  }, [src]);

  return (
    <div className={[styles.root, className ?? styles.defaultFrame].filter(Boolean).join(" ")} style={style}>
      {src ? (
        // biome-ignore lint/a11y/useMediaCaption: setVideoRef attaches a programmatic captions track.
        <video
          className={[styles.video, videoClassName].filter(Boolean).join(" ")}
          controls={controls}
          // 原生下载直接用 src 发起请求，拿不到登录态，改由外部按钮走 blob 下载。
          controlsList="nodownload"
          onEnded={onEnded}
          onError={onError}
          onLoadedMetadata={onLoadedMetadata}
          onPause={onPause}
          onPlay={onPlay}
          playsInline
          poster={poster}
          preload="metadata"
          ref={setVideoRef}
          src={src}
        />
      ) : (
        empty
      )}
    </div>
  );
});
