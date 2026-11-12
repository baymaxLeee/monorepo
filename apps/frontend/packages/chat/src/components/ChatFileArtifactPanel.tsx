import { resolveArtifactPreviewKind } from "@repo/ai-elements";
import { createStorageDownloadUrl, downloadAssetUrl } from "@repo/api";
import { Button, Toolbar, ToolbarButton, Tooltip, TooltipContent, TooltipTrigger, toast } from "@repo/design-system";
import { CodeEditor } from "@repo/editors/code-editor";
import { MarkdownEditor } from "@repo/editors/markdown-editor";
import { getErrorMessage } from "@repo/shared";
import {
  Code2Icon,
  DownloadIcon,
  EyeIcon,
  Loader2Icon,
  SaveIcon,
  XIcon,
  Maximize2Icon,
  Minimize2Icon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { useChatStore } from "../store/useChatStore";
import { ArtifactRouteGuard, ArtifactUnsavedChanges } from "./ArtifactUnsavedChanges";
import { ChatArtifactPreview } from "./ChatArtifactPreview";
import { useConversationFileEditor } from "./useConversationFileEditor";

export function ChatFileArtifactPanel({ onClose }: { onClose?: () => void }) {
  const { artifactPreview, closeArtifactPreview } = useChatStore(
    useShallow((state) => ({
      artifactPreview: state.artifactPreview,
      closeArtifactPreview: state.closeArtifactPreview,
    })),
  );
  const { open, conversationId, fileId, token } = artifactPreview;
  const editor = useConversationFileEditor(conversationId, fileId, open, token);
  const file = editor.file?.id === fileId ? editor.file : null;
  const kind = resolveArtifactPreviewKind(undefined, file?.mime_type, file?.filename);
  const markdown = /\.(md|markdown)$/i.test(file?.filename ?? "");
  const [downloading, setDownloading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const download = useCallback(async () => {
    if (!file || !conversationId) return;
    setDownloading(true);
    try {
      const capability = await createStorageDownloadUrl({
        assetId: file.asset_id,
        revisionId: file.revision_id,
        owner: { kind: "conversation-file", conversationId, fileId: file.id },
      });
      downloadAssetUrl(capability.url, capability.filename);
    } catch (error) {
      toast.add({ type: "error", title: getErrorMessage(error, "下载失败") });
    } finally {
      setDownloading(false);
    }
  }, [file, conversationId]);
  const close = () => {
    if (onClose)
      void editor.requestNavigation().then((allowed) => {
        if (allowed) onClose();
      });
    else closeArtifactPreview();
  };
  const label =
    editor.saveState === "saving"
      ? "保存中…"
      : editor.saveState === "saved"
        ? "已保存"
        : editor.saveState === "conflict"
          ? "内容已变化，草稿已保留"
          : editor.saveState === "error"
            ? "保存失败"
            : editor.dirty
              ? "未保存"
              : "";

  return (
    <div
      ref={panelRef}
      className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-background"
      onKeyDown={(event) => {
        if (editor.editing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void editor.runSave();
        }
      }}
    >
      <ArtifactRouteGuard dirty={editor.dirty} confirm={editor.requestNavigation} />
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{file?.title ?? (editor.loading ? "加载中…" : "预览")}</p>
          {file && (
            <p className="truncate text-xs text-muted-foreground">
              {file.filename} · {file.mime_type}
            </p>
          )}
        </div>
        {label && (
          <span className="max-w-64 truncate text-xs text-muted-foreground" role="status" aria-live="polite">
            {label}
          </span>
        )}
        <Toolbar aria-label="文件操作">
          {file?.editable && (
            <>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToolbarButton
                      aria-label={editor.editing ? "查看已保存预览" : "编辑文件"}
                      disabled={editor.loading}
                      onClick={() => {
                        if (editor.editing) editor.setEditing(false);
                        else void editor.beginEditing();
                      }}
                    />
                  }
                >
                  {editor.editing ? <EyeIcon className="size-4" /> : <Code2Icon className="size-4" />}
                </TooltipTrigger>
                <TooltipContent>{editor.editing ? "预览" : "编辑"}</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <ToolbarButton
                      aria-label="保存文件"
                      disabled={!editor.dirty || editor.saveState === "saving"}
                      onClick={() => void editor.runSave()}
                    />
                  }
                >
                  {editor.saveState === "saving" ? (
                    <Loader2Icon className="size-4 motion-safe:animate-spin" />
                  ) : (
                    <SaveIcon className="size-4" />
                  )}
                </TooltipTrigger>
                <TooltipContent>保存（Ctrl/⌘ S）</TooltipContent>
              </Tooltip>
            </>
          )}
          {file && (
            <Tooltip>
              <TooltipTrigger
                render={<ToolbarButton aria-label="下载产物" disabled={downloading} onClick={() => void download()} />}
              >
                {downloading ? (
                  <Loader2Icon className="size-4 motion-safe:animate-spin" />
                ) : (
                  <DownloadIcon className="size-4" />
                )}
              </TooltipTrigger>
              <TooltipContent>下载</TooltipContent>
            </Tooltip>
          )}
          {kind === "html" && !editor.editing && (
            <ToolbarButton
              aria-label={fullscreen ? "退出全屏" : "全屏"}
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void panelRef.current?.requestFullscreen();
              }}
            >
              {fullscreen ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
            </ToolbarButton>
          )}
          <ToolbarButton aria-label="关闭预览" onClick={close}>
            <XIcon className="size-4" />
          </ToolbarButton>
        </Toolbar>
      </div>
      {editor.error && (
        <div role="alert" className="flex shrink-0 items-center gap-2 px-3 py-2 text-sm text-destructive">
          <span>{editor.error}</span>
          <Button variant="outline" onClick={() => void editor.reloadFile()}>
            重新加载
          </Button>
        </div>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {editor.loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : file && editor.editing ? (
          markdown ? (
            <MarkdownEditor
              key={`${file.id}:${token}`}
              value={editor.draft}
              contentType="markdown"
              editable
              onChange={editor.changeDraft}
              className="h-full w-full"
            />
          ) : (
            <CodeEditor
              fileId={file.id}
              value={editor.draft}
              fileName={file.filename}
              onChange={editor.changeDraft}
              onSave={() => void editor.runSave()}
              className="h-full min-h-0 w-full"
            />
          )
        ) : file ? (
          <ChatArtifactPreview
            title={file.title}
            filename={file.filename}
            mimeType={file.mime_type}
            content=""
            asset={{
              assetId: file.asset_id,
              revisionId: file.revision_id,
              owner: { kind: "conversation-file", conversationId: conversationId!, fileId: file.id },
            }}
            showHeader={false}
            className="h-full min-h-0 min-w-0 overflow-hidden rounded-none border-0 bg-transparent shadow-none [&>div]:min-h-0 [&>div]:min-w-0 [&>div]:flex-1 [&_iframe]:h-full [&_iframe]:min-h-0 [&_iframe]:min-w-0"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">无法加载预览</div>
        )}
      </div>
      <ArtifactUnsavedChanges
        open={editor.confirmingNavigation}
        saving={editor.saveState === "saving"}
        resolve={editor.resolveNavigation}
        save={editor.runSave}
      />
    </div>
  );
}
