import type { ConversationDocumentDetail } from "api";
import { fetchConversationDocument } from "api";
import { Button } from "components";
import { ArtifactPreview } from "components/ai-chat";
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  fetchCachedDocumentSource,
  useDocumentBlobUrl,
} from "../hooks/useDocumentSource";
import { useChatStore } from "../store/useChatStore";

function needsBinarySource(mimeType: string | undefined) {
  return Boolean(
    mimeType?.startsWith("image/") ||
      mimeType?.startsWith("video/") ||
      mimeType?.startsWith("audio/") ||
      mimeType?.includes("pdf"),
  );
}

export function ChatArtifactPanel({ onClose }: { onClose?: () => void }) {
  const { artifactPreview, closeArtifactPreview } = useChatStore(
    useShallow((s) => ({
      artifactPreview: s.artifactPreview,
      closeArtifactPreview: s.closeArtifactPreview,
    })),
  );
  const handleClose = onClose ?? closeArtifactPreview;
  const { open, conversationId, documentId, token } = artifactPreview;
  const [artifact, setArtifact] = useState<ConversationDocumentDetail | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const binarySource = needsBinarySource(artifact?.mime_type);
  const {
    blobUrl: previewSrc,
    loading: blobLoading,
    error: blobError,
  } = useDocumentBlobUrl(
    conversationId ?? undefined,
    documentId,
    Boolean(open && binarySource),
    artifact?.updated_at ?? "",
  );

  useEffect(() => {
    if (!open || !conversationId || !documentId) {
      setArtifact(null);
      setPreviewHtml(null);
      return;
    }
    let active = true;
    setLoading(true);
    setArtifact(null);
    setPreviewHtml(null);
    setSourceError(false);
    void fetchConversationDocument(conversationId, documentId)
      .then((document) => {
        if (!active) return;
        setArtifact(document);
      })
      .catch(() => {
        if (!active) return;
        setArtifact(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [conversationId, documentId, open, token]);

  useEffect(() => {
    if (
      !open ||
      !conversationId ||
      !documentId ||
      artifact?.mime_type !== "text/html"
    ) {
      setSourceLoading(false);
      setSourceError(false);
      return;
    }
    let active = true;
    setSourceLoading(true);
    setSourceError(false);
    void fetchCachedDocumentSource(
      conversationId,
      documentId,
      artifact?.updated_at ?? "",
    )
      .then((blob) => blob.text())
      .then((html) => {
        if (active) setPreviewHtml(html);
      })
      .catch(() => {
        if (active) {
          setPreviewHtml(null);
          setSourceError(true);
        }
      })
      .finally(() => {
        if (active) setSourceLoading(false);
      });
    return () => {
      active = false;
    };
  }, [artifact?.mime_type, artifact?.updated_at, conversationId, documentId, open]);

  const previewLoading =
    loading ||
    sourceLoading ||
    Boolean(artifact && binarySource && blobLoading);
  const previewFailed = sourceError || Boolean(blobError);

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {artifact?.title ?? (previewLoading ? "加载中…" : "预览")}
          </p>
          {artifact ? (
            <p className="truncate text-xs text-muted-foreground">
              {artifact.filename} · {artifact.mime_type}
            </p>
          ) : null}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="关闭预览"
          onClick={handleClose}
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {previewLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : previewFailed ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            无法加载预览
          </div>
        ) : artifact ? (
          <ArtifactPreview
            title={artifact.title}
            filename={artifact.filename}
            mimeType={artifact.mime_type}
            content={previewHtml ?? artifact.content_md}
            src={previewSrc ?? undefined}
            showHeader={false}
            className="h-full min-h-0 overflow-hidden rounded-none border-0 bg-transparent shadow-none [&>div]:min-h-0 [&>div]:flex-1 [&>div]:overflow-y-auto [&>div]:overscroll-contain [&>div]:[scrollbar-width:none] [&>div]:[-ms-overflow-style:none] [&>div::-webkit-scrollbar]:hidden [&_iframe]:h-full [&_iframe]:min-h-0 [&_pre]:min-h-0 [&_pre]:overflow-visible"
          />
        ) : open ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            无法加载预览
          </div>
        ) : null}
      </div>
    </div>
  );
}
