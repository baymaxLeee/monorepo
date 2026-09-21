export type MediaPreviewSize = {
  height: number;
  width: number;
};

const MEDIA_PREVIEW_MAX_EDGE = 300;

export function fitMediaPreviewSize(width: number, height: number): MediaPreviewSize | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }

  const scale = MEDIA_PREVIEW_MAX_EDGE / Math.max(width, height);
  return {
    height: Math.round(height * scale),
    width: Math.round(width * scale),
  };
}
