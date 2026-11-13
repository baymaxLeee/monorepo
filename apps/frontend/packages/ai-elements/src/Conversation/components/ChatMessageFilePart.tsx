import { Attachment, AttachmentInfo, getMediaCategory } from "@repo/ai-elements";
import { cn } from "@repo/shared";
import type { FileUIPart, ReasoningFileUIPart } from "ai";
import { FileIcon, ImageIcon, Loader2Icon, type LucideIcon, MusicIcon, PlaySquareIcon } from "lucide-react";
import { useRef } from "react";

import { useDocumentBlobUrl } from "../hooks/useDocumentSource";
import { useInView } from "../hooks/useInView";
import { conversationFileIdFromFilePart, documentIdFromFilePart } from "../lib/file-parts";

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
  onOpenArtifact,
  onOpenFile,
  onOpenImage,
  variant = "assistant",
}: {
  part: FileUIPart | ReasoningFileUIPart;
  conversationId: string;
  partIndex: number;
  onOpenArtifact?: (documentId: string) => void;
  onOpenFile?: (fileId: string) => void;
  onOpenImage?: (partIndex: number) => void;
  variant?: "user" | "assistant";
}) {
  const documentId = documentIdFromFilePart(part);
  const fileId = conversationFileIdFromFilePart(part);
  const isImage = part.mediaType.startsWith("image/");
  const canOpen = fileId ? Boolean(onOpenFile) : isImage ? Boolean(onOpenImage) : Boolean(onOpenArtifact);
  const thumbRef = useRef<HTMLSpanElement>(null);
  const inView = useInView(thumbRef);
  const { blobUrl, loading } = useDocumentBlobUrl(
    conversationId,
    documentId,
    isImage && Boolean(documentId) && inView,
    { maxDim: IMAGE_THUMB_MAX_DIM },
  );

  if (!documentId && !fileId) {
    return <span className="rounded-full border border-dashed px-2 py-0.5 text-[11px] opacity-70">附件无效</span>;
  }

  const item: FileUIPart & { id: string } = {
    type: "file",
    mediaType: part.mediaType,
    url: part.url,
    filename: "filename" in part ? part.filename : undefined,
    providerMetadata: part.providerMetadata,
    id: documentId ?? fileId!,
  };
  const Icon = CATEGORY_ICON[getMediaCategory(item)] ?? FileIcon;

  return (
    <Attachment
      data={item}
      render={
        <button
          type="button"
          disabled={!canOpen}
          title={`预览 ${"filename" in part ? part.filename || part.mediaType : part.mediaType}`}
          className={cn(
            "max-w-[min(100%,20rem)] transition-colors hover:bg-muted/60",
            variant === "user" && "bg-background/90 shadow-sm",
          )}
          onClick={() => {
            if (fileId) onOpenFile?.(fileId);
            else if (isImage) onOpenImage?.(partIndex);
            else onOpenArtifact?.(documentId!);
          }}
        />
      }
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
            alt={("filename" in part && part.filename) || part.mediaType}
            className="size-full object-cover"
          />
        ) : isImage && loading ? (
          <Loader2Icon className="size-4 animate-spin" />
        ) : (
          <Icon className="size-4" />
        )}
      </span>
      <AttachmentInfo showMediaType />
    </Attachment>
  );
}
