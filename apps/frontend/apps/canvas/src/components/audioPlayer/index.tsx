import { type AudioHTMLAttributes, type CSSProperties, type ReactNode, forwardRef } from "react";

import styles from "./index.module.less";

type AudioPlayerProps = {
  audioClassName?: string;
  className?: string;
  controls?: boolean;
  crossOrigin?: AudioHTMLAttributes<HTMLAudioElement>["crossOrigin"];
  empty?: ReactNode;
  src?: string;
  style?: CSSProperties;
  onEnded?: AudioHTMLAttributes<HTMLAudioElement>["onEnded"];
  onPause?: AudioHTMLAttributes<HTMLAudioElement>["onPause"];
  onPlay?: AudioHTMLAttributes<HTMLAudioElement>["onPlay"];
};

/**
 * 音频资产播放器：沿用浏览器原生控件，播放、进度、时间、音量都由浏览器提供，
 * 和 VideoPlayer 保持一致，外观按设计稿做有限调整（见同名 less）。
 */
export const AudioPlayer = forwardRef<HTMLAudioElement, AudioPlayerProps>(function AudioPlayer(
  { audioClassName, className, controls = true, crossOrigin, empty, src, style, onEnded, onPause, onPlay },
  ref,
) {
  return (
    <div className={[styles.root, className ?? styles.defaultFrame].filter(Boolean).join(" ")} style={style}>
      {src || !controls ? (
        // 关掉下载和倍速，且不挂字幕轨，Chrome 右侧 ⋮ 溢出菜单就没有可展示项了。
        // biome-ignore lint/a11y/useMediaCaption: 上传音频无字幕轨，空 track 反而会冒出「字幕」菜单。
        <audio
          className={[styles.player, audioClassName].filter(Boolean).join(" ")}
          controls={controls}
          controlsList="nodownload noplaybackrate"
          crossOrigin={crossOrigin}
          onEnded={onEnded}
          onPause={onPause}
          onPlay={onPlay}
          preload="metadata"
          ref={ref}
          src={src}
        />
      ) : (
        empty
      )}
    </div>
  );
});
