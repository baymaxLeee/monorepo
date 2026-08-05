import { useCallback, useState } from "react";

import type { ImagePreviewItem } from "./interface";

export function useImagePreview() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [images, setImages] = useState<ImagePreviewItem[]>([]);

  const openPreview = useCallback((next: ImagePreviewItem[], startIndex = 0) => {
    setImages(next);
    setIndex(Math.min(Math.max(startIndex, 0), Math.max(next.length - 1, 0)));
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  return { open, index, images, openPreview, close, setOpen, setIndex };
}
