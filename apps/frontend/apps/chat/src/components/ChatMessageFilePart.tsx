import type { FileUIPart } from "ai";
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
} from "components/ai-chat";
import { useEffect, useRef, useState } from "react";
import { cn } from "shared";
import { useDocumentBlobUrl } from "../hooks/useDocumentSource";
import { documentIdFromFilePart } from "../lib/file-parts";

export function ChatMessageFilePart({
  conversationId,
  part,
  onOpen,
  variant = "assistant",
}: {
  conversationId: string;
  part: FileUIPart;
  onOpen: (documentId: string) => void;
  variant?: "user" | "assistant";
}) {
  const rootRef = useRef<HTMLButtonElement>(null);
  const [visible, setVisible] = useState(false);
  const documentId = documentIdFromFilePart(part);
  const isImage = part.mediaType.startsWith("image/");

  useEffect(() => {
    const node = rootRef.current;
    if (!node || !isImage || visible) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [isImage, visible]);

  const { blobUrl, loading, error } = useDocumentBlobUrl(
    conversationId,
    documentId,
    Boolean(documentId && isImage && visible),
  );

  if (!documentId) {
    return (
      <span className="rounded-full border border-dashed px-2 py-0.5 text-[11px] opacity-70">
        附件无效
      </span>
    );
  }

  const displayPart = blobUrl ? { ...part, url: blobUrl } : part;
  return (
    <Attachment data={{ ...displayPart, id: documentId }} asChild>
      <button
        ref={rootRef}
        type="button"
        title={`预览 ${part.filename || part.mediaType}`}
        className={cn(
          "max-w-[min(100%,20rem)] transition-colors hover:bg-muted/60",
          variant === "user" && "bg-background/90 shadow-sm",
        )}
        onClick={() => onOpen(documentId)}
      >
        {isImage && (loading || error || !blobUrl) ? (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] text-muted-foreground">
            {loading ? "加载中" : error ? "失败" : "图片"}
          </span>
        ) : (
          <AttachmentPreview />
        )}
        {isImage ? null : <AttachmentInfo showMediaType={!isImage} />}
      </button>
    </Attachment>
  );
}
