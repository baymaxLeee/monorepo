import { ArtifactAction, ArtifactPreview } from "@repo/ai-elements";
import type { ConversationFileDetail } from "@repo/api";
import { createKnowledgeFileResourceUrl, fetchConversationFile } from "@repo/api";
import { Button, toast } from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { DownloadIcon, Loader2Icon, Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const [sourceError, setSourceError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const previewFile = file?.path === path ? file : null;
  const isChangingFile = Boolean(file && path && file.path !== path);
  const isHtmlFile = previewFile?.mime_type.toLowerCase() === "text/html";

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
        if (active) {
          setFile(result);
        }
      })
      .catch(() => {
        if (active) {
          setFile(null);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [conversationId, open, path, token]);

  useEffect(() => {
    if (!conversationId || !path || !isHtmlFile) {
      setPreviewUrl(undefined);
      setSourceLoading(false);
      setSourceError(false);
      return;
    }
    let active = true;
    setPreviewUrl(undefined);
    setSourceLoading(true);
    setSourceError(false);
    void createKnowledgeFileResourceUrl(conversationId, path)
      .then((resource) => {
        if (!active) {
          return;
        }
        setPreviewUrl(resource.url);
      })
      .catch(() => {
        if (active) {
          setPreviewUrl(undefined);
          setSourceError(true);
        }
      })
      .finally(() => {
        if (active) {
          setSourceLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [conversationId, isHtmlFile, path, previewFile?.sha256]);

  useEffect(() => {
    const sync = () => {
      const root = panelRef.current;
      const element = document.fullscreenElement;
      setIsFullscreen(Boolean(root && element && (element === root || root.contains(element))));
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const root = panelRef.current;
    if (!root) {
      return;
    }
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await root.requestFullscreen();
    }
  }, []);

  const downloadFile = useCallback(async () => {
    if (!previewFile) {
      return;
    }
    setDownloading(true);
    try {
      let blob: Blob;
      if (isHtmlFile) {
        if (!previewUrl) {
          return;
        }
        const response = await fetch(previewUrl);
        if (!response.ok) {
          throw new Error(`file download failed: ${response.status}`);
        }
        blob = await response.blob();
      } else {
        blob = new Blob([previewFile.content ?? ""], { type: previewFile.mime_type });
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = previewFile.filename.split("/").at(-1) ?? "artifact";
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(getErrorMessage(error, "下载失败"));
    } finally {
      setDownloading(false);
    }
  }, [isHtmlFile, previewFile, previewUrl]);

  return (
    <div ref={panelRef} className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{previewFile?.title ?? (loading ? "加载中…" : "预览")}</p>
          {previewFile ? (
            <p className="truncate text-xs text-muted-foreground">
              {previewFile.path} · {previewFile.mime_type}
            </p>
          ) : null}
        </div>
        {previewFile ? (
          <ArtifactAction
            tooltip={downloading ? "下载中…" : "下载"}
            label="下载产物"
            disabled={downloading || (isHtmlFile && !previewUrl)}
            onClick={() => void downloadFile()}
          >
            {downloading ? <Loader2Icon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
          </ArtifactAction>
        ) : null}
        {isHtmlFile && previewUrl ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label={isFullscreen ? "退出全屏" : "全屏"}
            onClick={() => void toggleFullscreen()}
          >
            {isFullscreen ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
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
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {loading || isChangingFile || sourceLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : sourceError ? (
          <div className="flex h-full items-center justify-center p-4 text-center text-sm text-muted-foreground">
            无法加载预览
          </div>
        ) : previewFile ? (
          <ArtifactPreview
            title={previewFile.title}
            filename={previewFile.filename}
            mimeType={previewFile.mime_type}
            content={previewFile.content ?? ""}
            src={isHtmlFile ? previewUrl : undefined}
            showHeader={false}
            className="h-full min-h-0 min-w-0 overflow-hidden rounded-none border-0 bg-transparent shadow-none [&>div]:min-h-0 [&>div]:min-w-0 [&>div]:flex-1 [&>div]:overflow-y-auto [&_iframe]:h-full [&_iframe]:min-h-0 [&_iframe]:min-w-0"
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
