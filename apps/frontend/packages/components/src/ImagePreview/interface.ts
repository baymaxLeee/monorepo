export interface ImagePreviewItem {
  src?: string | null;
  alt?: string;
  caption?: string;
}

export interface ImagePreviewProps {
  images: ImagePreviewItem[];
  open: boolean;
  index: number;
  onOpenChange: (open: boolean) => void;
  onIndexChange: (index: number) => void;
  loop?: boolean;
  className?: string;
}
