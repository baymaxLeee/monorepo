import { useUpdateNodeInternals } from "@xyflow/react";
import { type CSSProperties, type SyntheticEvent, useCallback, useEffect, useState } from "react";

import { type MediaPreviewSize, fitMediaPreviewSize } from "./mediaNodeSize";
export const MEDIA_ASSET_DEFAULT_PREVIEW_SIZE = { height: 169, width: 300 };
export const MEDIA_GENERATION_DEFAULT_PREVIEW_SIZE = {
  height: 300,
  width: 300,
};

export type MediaPreviewStyle = CSSProperties & {
  "--canvas-media-preview-height": string;
  "--canvas-media-preview-width": string;
};

export function useMediaNodePreviewSize(nodeID: string, source: string | undefined, fallback: MediaPreviewSize) {
  const updateNodeInternals = useUpdateNodeInternals();
  const [loaded, setLoaded] = useState<(MediaPreviewSize & { source: string }) | undefined>();
  const size = loaded && loaded.source === source ? loaded : fallback;
  const updateSize = useCallback(
    (width: number, height: number) => {
      if (!source) return;
      const next = fitMediaPreviewSize(width, height);
      if (next) setLoaded({ ...next, source });
    },
    [source],
  );
  const onImageLoad = useCallback(
    (event: SyntheticEvent<HTMLImageElement>) => {
      updateSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight);
    },
    [updateSize],
  );
  const onVideoLoadedMetadata = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      updateSize(event.currentTarget.videoWidth, event.currentTarget.videoHeight);
    },
    [updateSize],
  );

  useEffect(() => {
    updateNodeInternals(nodeID);
  }, [nodeID, size.height, size.width, updateNodeInternals]);

  return {
    onImageLoad,
    onVideoLoadedMetadata,
    style: {
      "--canvas-media-preview-height": `${size.height}px`,
      "--canvas-media-preview-width": `${size.width}px`,
    } as MediaPreviewStyle,
  };
}
