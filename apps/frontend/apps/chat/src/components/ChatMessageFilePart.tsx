import type { FileUIPart } from "ai";
import {
  Attachment,
  AttachmentInfo,
  getMediaCategory,
} from "components/ai-chat";
import {
  FileIcon,
  ImageIcon,
  Loader2Icon,
  type LucideIcon,
  MusicIcon,
  PlaySquareIcon,
} from "lucide-react";
import { useRef } from "react";
import { cn } from "shared";
import { useDocumentBlobUrl } from "../hooks/useDocumentSource";
import { useInView } from "../hooks/useInView";
import { documentIdFromFilePart } from "../lib/file-parts";

const IMAGE_THUMB_MAX_DIM = 192;

const CATEGORY_ICON: Record<string, LucideIcon> = {
  image: ImageIcon,
  video: PlaySquareIcon,
  audio: MusicIcon,
};

export function ChatMessageFilePart({
  part,
  conversationId,
  partIndex,
  onOpen,
  onOpenImage,
  variant = "assistant",
}: {
  part: FileUIPart;
  conversationId: string;
  partIndex: number;
  onOpen: (documentId: string) => void;
  onOpenImage: (partIndex: number) => void;
  variant?: "user" | "assistant";
}) {
  const documentId = documentIdFromFilePart(part);
  const isImage = part.mediaType.startsWith("image/");
  const thumbRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(thumbRef);
  const { blobUrl, loading } = useDocumentBlobUrl(
    conversationId,
    documentId,
    isImage && Boolean(documentId) && inView,
    { maxDim: IMAGE_THUMB_MAX_DIM },
  );

  if (!documentId) {
    return (
      <span className="rounded-full border border-dashed px-2 py-0.5 text-[11px] opacity-70">
        附件无效
      </span>
    );
  }

  const item = { ...part, id: documentId };
  const Icon = CATEGORY_ICON[getMediaCategory(item)] ?? FileIcon;

  return (
    <Attachment data={item} asChild>
      <button
        type="button"
        title={`预览 ${part.filename || part.mediaType}`}
        className={cn(
          "max-w-[min(100%,20rem)] transition-colors hover:bg-muted/60",
          variant === "user" && "bg-background/90 shadow-sm",
        )}
        onClick={() => (isImage ? onOpenImage(partIndex) : onOpen(documentId))}
      >
        <span
          ref={thumbRef}
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted text-muted-foreground",
            isImage ? "size-12" : "size-8",
          )}
        >
          {isImage && blobUrl ? (
            <img
              src={blobUrl}
              alt={part.filename || part.mediaType}
              className="size-full object-cover"
            />
          ) : isImage && loading ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <Icon className="size-4" />
          )}
        </span>
        <AttachmentInfo showMediaType />
      </button>
    </Attachment>
  );
}
