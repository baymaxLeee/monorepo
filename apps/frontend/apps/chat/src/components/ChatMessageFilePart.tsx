import type { FileUIPart } from "ai";
import { fetchConversationDocumentSource } from "api";
import { FileIcon, MusicIcon, PlaySquareIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "shared";
import { documentIdFromFilePart } from "../lib/file-parts";

function useAuthenticatedBlobUrl(
  conversationId: string,
  documentId: string | null,
  enabled: boolean,
) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !documentId) {
      setBlobUrl(null);
      setError(null);
      return;
    }
    let active = true;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    void fetchConversationDocumentSource(conversationId, documentId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch((err) => {
        if (!active) return;
        setError(String(err));
        setBlobUrl(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [conversationId, documentId, enabled]);

  return { blobUrl, loading, error };
}

function fileKind(mediaType: string) {
  if (mediaType.startsWith("image/")) return "image" as const;
  if (mediaType.startsWith("video/")) return "video" as const;
  if (mediaType.startsWith("audio/")) return "audio" as const;
  return "file" as const;
}

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
  const documentId = documentIdFromFilePart(part);
  const kind = fileKind(part.mediaType);
  const title = part.filename || part.mediaType || "附件";
  const showThumbnail = kind === "image" && Boolean(documentId);
  const { blobUrl, loading, error } = useAuthenticatedBlobUrl(
    conversationId,
    documentId,
    showThumbnail,
  );

  if (!documentId) {
    return (
      <span className="rounded-full border border-dashed px-2 py-0.5 text-[11px] opacity-70">
        附件无效
      </span>
    );
  }

  if (kind === "image") {
    return (
      <button
        type="button"
        title={`预览 ${title}`}
        className={cn(
          "block max-w-xs overflow-hidden rounded-xl border text-left transition-colors hover:border-border",
          variant === "user"
            ? "border-border/70 bg-background/90 shadow-sm"
            : "border-border bg-muted/30",
        )}
        onClick={() => onOpen(documentId)}
      >
        <div className="px-2 py-1 text-[11px] font-medium opacity-80">{title}</div>
        <div className="border-t border-inherit bg-black/5 dark:bg-black/20">
          {loading ? (
            <div className="flex h-28 items-center justify-center text-[11px] opacity-70">
              加载中…
            </div>
          ) : error ? (
            <div className="flex h-28 items-center justify-center px-2 text-center text-[11px] text-red-500">
              预览失败
            </div>
          ) : blobUrl ? (
            <img src={blobUrl} alt={title} className="max-h-44 w-full object-contain" />
          ) : null}
        </div>
      </button>
    );
  }

  return (
    <button
      type="button"
      title={`预览 ${title}`}
      className={cn(
        "inline-flex max-w-[min(100%,18rem)] items-center gap-1.5 rounded-lg border px-2 py-1 text-left text-xs transition-colors",
        variant === "user"
          ? "border-border/80 bg-background/90 text-foreground shadow-sm hover:bg-background"
          : "border-border bg-muted/40 text-foreground hover:bg-muted/70",
      )}
      onClick={() => onOpen(documentId)}
    >
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-md",
          variant === "user" ? "bg-muted text-muted-foreground" : "bg-muted",
        )}
      >
        {kind === "video" ? (
          <PlaySquareIcon className="size-3 opacity-80" />
        ) : kind === "audio" ? (
          <MusicIcon className="size-3 opacity-80" />
        ) : (
          <FileIcon className="size-3 opacity-80" />
        )}
      </span>
      <span className="min-w-0 truncate font-medium">{title}</span>
    </button>
  );
}

export function useDocumentPreviewSource(
  conversationId: string | undefined,
  documentId: string | null,
  open: boolean,
) {
  return useAuthenticatedBlobUrl(
    conversationId ?? "",
    documentId,
    Boolean(open && conversationId && documentId),
  );
}
