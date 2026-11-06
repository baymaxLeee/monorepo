import { resolveArtifactPreviewKind } from "@repo/ai-elements";
import type { ConversationFileDetail } from "@repo/api";
import { createStorageDownloadUrl, downloadAssetUrl, fetchConversationFile } from "@repo/api";
import { Toolbar, ToolbarButton, Tooltip, TooltipTrigger, TooltipContent, toast } from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { DownloadIcon, Loader2Icon, Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useChatStore } from "../store/useChatStore";
import { ChatArtifactPreview } from "./ChatArtifactPreview";

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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const previewFile = file?.path === path ? file : null;
  const isChangingFile = Boolean(file && path && file.path !== path);
  const isHtmlFile = resolveArtifactPreviewKind(undefined, previewFile?.mime_type, previewFile?.filename) === "html";

  useEffect(() => {
    if (!open || !conversationId || !path) {
      setFile(null);
      return;
    }
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setFile(null);
    void fetchConversationFile(conversationId, path, { includeContent: false, signal: controller.signal })
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
      controller.abort();
    };
  }, [conversationId, open, path, token]);

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
      const capability = await createStorageDownloadUrl({
        assetId: previewFile.asset_id,
        revisionId: previewFile.revision_id,
        owner: { kind: "conversation-file", conversationId: conversationId!, path: previewFile.path },
      });
      downloadAssetUrl(capability.url, capability.filename);
    } catch (error) {
      toast.add({ type: "error", title: getErrorMessage(error, "下载失败") });
    } finally {
      setDownloading(false);
    }
  }, [previewFile]);

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
        <Toolbar aria-label="文件预览操作">
          {previewFile ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <ToolbarButton aria-label="下载产物" disabled={downloading} onClick={() => void downloadFile()} />
                }
              >
                {downloading ? (
                  <Loader2Icon className="size-4 motion-safe:animate-spin" />
                ) : (
                  <DownloadIcon className="size-4" />
                )}
              </TooltipTrigger>
              <TooltipContent>{downloading ? "下载中…" : "下载"}</TooltipContent>
            </Tooltip>
          ) : null}
          {isHtmlFile ? (
            <ToolbarButton
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0"
              aria-label={isFullscreen ? "退出全屏" : "全屏"}
              onClick={() => void toggleFullscreen()}
            >
              {isFullscreen ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
            </ToolbarButton>
          ) : null}
          <ToolbarButton
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="关闭预览"
            onClick={handleClose}
          >
            <XIcon className="size-4" />
          </ToolbarButton>
        </Toolbar>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {loading || isChangingFile ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : previewFile ? (
          <ChatArtifactPreview
            title={previewFile.title}
            filename={previewFile.filename}
            mimeType={previewFile.mime_type}
            content=""
            asset={{
              assetId: previewFile.asset_id,
              revisionId: previewFile.revision_id,
              owner: { kind: "conversation-file", conversationId: conversationId!, path: previewFile.path },
            }}
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
