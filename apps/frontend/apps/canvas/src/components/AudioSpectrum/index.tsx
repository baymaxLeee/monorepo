import { STATIC_AUDIO_SPECTRUM_HEIGHTS } from "./audioSpectrum";

import styles from "./index.module.less";

type AudioSpectrumProps = {
  className?: string;
  fallback?: boolean;
  heights?: number[];
  playing?: boolean;
};

export function AudioSpectrum({
  className,
  fallback = false,
  heights = STATIC_AUDIO_SPECTRUM_HEIGHTS,
  playing = false,
}: AudioSpectrumProps) {
  return (
    <div
      aria-hidden
      className={[
        styles.root,
        playing ? styles.playing : "",
        fallback && playing ? styles.fallbackPlaying : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {heights.map((height, index) => (
        <span
          key={index}
          style={{
            backgroundPosition: `${heights.length > 1 ? (index / (heights.length - 1)) * 100 : 50}% center`,
            height,
          }}
        />
      ))}
    </div>
  );
}

export { STATIC_AUDIO_SPECTRUM_HEIGHTS } from "./audioSpectrum";
export { useAudioSpectrum } from "./useAudioSpectrum";
