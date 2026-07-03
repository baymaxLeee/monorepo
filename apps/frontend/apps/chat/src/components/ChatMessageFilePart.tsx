import type { FileUIPart } from "ai";
import {
  Attachment,
  AttachmentInfo,
  getMediaCategory,
} from "components/ai-chat";
import {
  FileIcon,
  ImageIcon,
  type LucideIcon,
  MusicIcon,
  PlaySquareIcon,
} from "lucide-react";
import { cn } from "shared";
import { documentIdFromFilePart } from "../lib/file-parts";

const CATEGORY_ICON: Record<string, LucideIcon> = {
  image: ImageIcon,
  video: PlaySquareIcon,
  audio: MusicIcon,
};

// A file attachment renders as a lightweight chip only — icon + filename, never
// the bytes (ADR-0021). Clicking an image opens the shared lightbox; any other
// file opens the side panel. Both preview surfaces fetch the source on demand,
// so the transcript stays cheap to render even with many attachments.
export function ChatMessageFilePart({
  part,
  onOpen,
  onOpenImage,
  variant = "assistant",
}: {
  part: FileUIPart;
  onOpen: (documentId: string) => void;
  onOpenImage: (documentId: string) => void;
  variant?: "user" | "assistant";
}) {
  const documentId = documentIdFromFilePart(part);
  const isImage = part.mediaType.startsWith("image/");

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
        onClick={() => (isImage ? onOpenImage(documentId) : onOpen(documentId))}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <Icon className="size-4" />
        </span>
        <AttachmentInfo showMediaType />
      </button>
    </Attachment>
  );
}
