import {
  FileText,
  Image,
  ImagePlus,
  Music,
  PanelsTopLeft,
  Type,
  Video,
  WandSparkles,
  type LucideProps,
} from "lucide-react";

import { canvasnode } from "@/domain";

export function CanvasNodeIcon({ nodeType, ...props }: LucideProps & { nodeType: canvasnode.CanvasNodeType }) {
  switch (nodeType) {
    case canvasnode.CanvasNodeType.IMAGE_ASSET:
      return <Image {...props} />;
    case canvasnode.CanvasNodeType.VIDEO_ASSET:
      return <Video {...props} />;
    case canvasnode.CanvasNodeType.AUDIO_ASSET:
      return <Music {...props} />;
    case canvasnode.CanvasNodeType.TEXT:
      return <Type {...props} />;
    case canvasnode.CanvasNodeType.IMAGE_GENERATION:
      return <ImagePlus {...props} />;
    case canvasnode.CanvasNodeType.VIDEO_GENERATION:
      return <WandSparkles {...props} />;
    case canvasnode.CanvasNodeType.TEXT_GENERATION:
      return <FileText {...props} />;
    case canvasnode.CanvasNodeType.STORYBOARD_DRAFT:
      return <PanelsTopLeft {...props} />;
    default:
      return null;
  }
}
