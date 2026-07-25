import type { ConversationFileDetail } from "api";
import { fetchConversationFile, fetchConversationFileSource } from "api";
import { Button, toast } from "components";
import { ArtifactAction, ArtifactPreview } from "components/ai-chat";
import {
  DownloadIcon,
  Loader2Icon,
  Maximize2Icon,
  Minimize2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage } from "shared";
import { useShallow } from "zustand/react/shallow";

import { useChatStore } from "../store/useChatStore";

export function ChatFileArtifactPanel({ onClose }: { onClose?: () => void }) {
  const { artifactPreview, closeArtifactPreview } = useChatStore(
    useShallow((state) => ({
      artifactPreview: state.artifactPreview,
      closeArtifactPreview: state.closeArtifactPreview,
    })),
  );
  const { open, conversationId, path, token } = artifactPreview;
  const handleClose = onClose ?? closeArtifactPreview;
  const [file, setFile] = useState<ConversationFileDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | undefined>();
  const [sourceLoading, setSourceLoading] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !conversationId || !path) {
      setFile(null);
      return;
    }
    let active = true;
    setLoading(true);
    setFile(null);
    void fetchConversationFile(conversationId, path)
      .then((result) => {
        if (active) setFile(result);
      })
      .catch(() => {
        if (active) setFile(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [conversationId, open, path, token]);

  useEffect(() => {
    if (!conversationId || !path || file?.mime_type !== "text/html") {
      setPreviewUrl(undefined);
      setSourceLoading(false);
      return;
    }
    let active = true;
    let objectUrl: string | undefined;
    setPreviewUrl(undefined);
    setSourceLoading(true);
    void fetchConversationFileSource(conversationId, path)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => {
        if (active) setPreviewUrl(undefined);
      })
      .finally(() => {
        if (active) setSourceLoading(false);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [conversationId, file?.mime_type, path]);

  useEffect(() => {
    const sync = () => {
      const root = panelRef.current;
      const element = document.fullscreenElement;
      setIsFullscreen(
        Boolean(
          root && element && (element === root || root.contains(element)),
        ),
      );
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const root = panelRef.current;
    if (!root) return;
    if (document.fullscreenElement) await document.exitFullscreen();
    else await root.requestFullscreen();
  }, []);

  const downloadFile = useCallback(() => {
    if (!file) return;
    setDownloading(true);
    try {
      const url = URL.createObjectURL(
        new Blob([file.content], { type: file.mime_type }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.filename.split("/").at(-1) ?? "artifact";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(getErrorMessage(error, "下载失败"));
    } finally {
      setDownloading(false);
    }
  }, [file]);

  return (
    <div
      ref={panelRef}
      className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {file?.title ?? (loading ? "加载中…" : "预览")}
          </p>
          {file ? (
            <p className="truncate text-xs text-muted-foreground">
              {file.path} · {file.mime_type}
            </p>
          ) : null}
        </div>
        {file ? (
          <ArtifactAction
            tooltip={downloading ? "下载中…" : "下载"}
            label="下载产物"
            disabled={downloading}
            onClick={downloadFile}
          >
            {downloading ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : (
              <DownloadIcon className="size-4" />
            )}
          </ArtifactAction>
        ) : null}
        {file?.mime_type === "text/html" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={isFullscreen ? "退出全屏" : "全屏"}
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? (
              <Minimize2Icon className="size-4" />
            ) : (
              <Maximize2Icon className="size-4" />
            )}
          </Button>
        ) : null}
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
        {loading || sourceLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
        ) : file ? (
          <ArtifactPreview
            title={file.title}
            filename={file.filename}
            mimeType={file.mime_type}
            content={file.content}
            src={previewUrl}
            showHeader={false}
            className="h-full min-h-0 overflow-hidden rounded-none border-0 bg-transparent shadow-none [&>div]:min-h-0 [&>div]:flex-1 [&>div]:overflow-y-auto [&_iframe]:h-full [&_iframe]:min-h-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            无法加载预览
          </div>
        )}
      </div>
    </div>
  );
}
