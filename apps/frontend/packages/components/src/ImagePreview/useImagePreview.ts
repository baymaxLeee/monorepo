import { useCallback, useState } from "react";
import type { ImagePreviewItem } from "./interface";

// Standalone state for the common "render thumbnails, click to open" case:
// `openPreview(images, index)` sets the group and opens at a slide. Consumers
// that manage open/index elsewhere (a store slice, a URL param) can use the
// controlled <ImagePreview> directly and skip this hook.
export function useImagePreview() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [images, setImages] = useState<ImagePreviewItem[]>([]);

  const openPreview = useCallback(
    (next: ImagePreviewItem[], startIndex = 0) => {
      setImages(next);
      setIndex(Math.min(Math.max(startIndex, 0), Math.max(next.length - 1, 0)));
      setOpen(true);
    },
    [],
  );

  const close = useCallback(() => setOpen(false), []);

  return { open, index, images, openPreview, close, setOpen, setIndex };
}
