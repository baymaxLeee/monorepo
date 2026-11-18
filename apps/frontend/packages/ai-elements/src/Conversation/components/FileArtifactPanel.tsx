import { resolveArtifactPreviewKind } from "@repo/ai-elements";
import type { StorageDeliveryRef } from "@repo/api";
import { Button, Toolbar, ToolbarButton, Tooltip, TooltipContent, TooltipTrigger, toast } from "@repo/design-system";
import { CodeEditor } from "@repo/editors/code-editor";
import { MarkdownEditor } from "@repo/editors/markdown-editor";
import { getErrorMessage } from "@repo/shared";
import {
  Code2Icon,
  DownloadIcon,
  EyeIcon,
  Loader2Icon,
  Maximize2Icon,
  Minimize2Icon,
  SaveIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ArtifactRouteGuard, ArtifactUnsavedChanges } from "./ArtifactUnsavedChanges";
import { ChatArtifactPreview } from "./ChatArtifactPreview";

export type FileArtifactSaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export type FileArtifactDescriptor = {
  id: string;
  title: string;
  filename: string;
  mimeType?: string;
  editable: boolean;
};

export type FileArtifactEditor = {
  loading: boolean;
  draft: string;
  dirty: boolean;
  editing: boolean;
  setEditing: (editing: boolean) => void;
  saveState: FileArtifactSaveState;
  error: string | null;
  confirmingNavigation: boolean;
  beginEditing: () => Promise<void>;
  changeDraft: (value: string) => void;
  runSave: () => Promise<boolean>;
  requestNavigation: () => Promise<boolean>;
  resolveNavigation: (allowed: boolean) => void;
  reloadFile: () => Promise<void>;
};

export function FileArtifactPanel({
  file,
  editor,
  previewContent = "",
  previewAsset,
  revision,
  onDownload,
  onClose,
}: {
  file: FileArtifactDescriptor | null;
  editor: FileArtifactEditor;
  previewContent?: string;
  previewAsset?: StorageDeliveryRef;
  revision: string | number;
  onDownload?: () => Promise<void>;
  onClose: () => void;
}) {
  const kind = resolveArtifactPreviewKind(undefined, file?.mimeType, file?.filename);
  const markdown = /\.(md|markdown)$/i.test(file?.filename ?? "");
  const [downloading, setDownloading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement === panelRef.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  const download = async () => {
    if (!onDownload) return;
    setDownloading(true);
    try {
      await onDownload();
    } catch (error) {
      toast.add({ type: "error", title: getErrorMessage(error, "下载失败") });
    } finally {
      setDownloading(false);
    }
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
          {file ? (
            <p className="truncate text-xs text-muted-foreground">
              {file.filename}
              {file.mimeType ? ` · ${file.mimeType}` : ""}
            </p>
          ) : null}
        </div>
        {label ? (
          <span className="max-w-64 truncate text-xs text-muted-foreground" role="status" aria-live="polite">
            {label}
          </span>
        ) : null}
        <Toolbar aria-label="文件操作">
          {file?.editable ? (
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
          ) : null}
          {file && onDownload ? (
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
          ) : null}
          {kind === "html" && !editor.editing ? (
            <ToolbarButton
              aria-label={fullscreen ? "退出全屏" : "全屏"}
              onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen();
                else void panelRef.current?.requestFullscreen();
              }}
            >
              {fullscreen ? <Minimize2Icon className="size-4" /> : <Maximize2Icon className="size-4" />}
            </ToolbarButton>
          ) : null}
          <ToolbarButton aria-label="关闭预览" onClick={onClose}>
            <XIcon className="size-4" />
          </ToolbarButton>
        </Toolbar>
      </div>
      {editor.error ? (
        <div role="alert" className="flex shrink-0 items-center gap-2 px-3 py-2 text-sm text-destructive">
          <span>{editor.error}</span>
          <Button variant="outline" onClick={() => void editor.reloadFile()}>
            重新加载
          </Button>
        </div>
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {editor.loading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : file && editor.editing ? (
          markdown ? (
            <MarkdownEditor
              key={`${file.id}:${revision}`}
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
            mimeType={file.mimeType}
            content={previewContent}
            asset={previewAsset}
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
