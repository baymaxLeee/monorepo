import type { ComponentProps } from "react";

import { VideoPlayer } from "@/components/videoPlayer/index";

import styles from "../CanvasBoard.module.less";

type CanvasNodeVideoPlayerProps = Pick<ComponentProps<typeof VideoPlayer>, "onLoadedMetadata" | "poster" | "src"> & {
  dragging: boolean;
  selected: boolean;
};

export function CanvasNodeVideoPlayer({ dragging, selected, ...videoProps }: CanvasNodeVideoPlayerProps) {
  return (
    <VideoPlayer
      {...videoProps}
      className={styles.mediaPlayer}
      controls={selected && !dragging}
      style={dragging ? { pointerEvents: "none" } : undefined}
    />
  );
}
