export interface ImagePreviewItem {
  // Resolved image URL. When null/undefined the viewer shows a loading state,
  // so consumers can open the lightbox before every source has resolved (e.g.
  // blob URLs fetched on demand).
  src?: string | null;
  alt?: string;
  caption?: string;
}

export interface ImagePreviewProps {
  images: ImagePreviewItem[];
  open: boolean;
  // Current slide. Controlled so the same overlay works with local state, a
  // store slice, or a URL param.
  index: number;
  onOpenChange: (open: boolean) => void;
  onIndexChange: (index: number) => void;
  // Wrap around past the first/last image. Defaults to true.
  loop?: boolean;
  className?: string;
}
