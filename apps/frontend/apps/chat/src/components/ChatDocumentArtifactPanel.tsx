import { ArtifactAction, ArtifactPreview } from "@repo/ai-elements";
import type { ConversationDocumentDetail } from "@repo/api";
import { fetchConversationDocument, updateConversationDocument } from "@repo/api";
import { Button, toast } from "@repo/design-system";
import { MarkdownEditor } from "@repo/editors/markdown-editor";
import { getErrorMessage } from "@repo/shared";
import { DownloadIcon, Loader2Icon, Maximize2Icon, Minimize2Icon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { downloadConversationDocument, useDocumentBlobUrl, useDocumentResourceUrl } from "../hooks/useDocumentSource";
import { useChatStore } from "../store/useChatStore";

// Autosave fires 1.5s after the user stops typing — long enough to coalesce a
// burst of keystrokes into a single PATCH, short enough to feel automatic.
const AUTOSAVE_DELAY_MS = 1500;

type SaveState = "idle" | "saving" | "saved" | "error";

function needsBinarySource(mimeType: string | undefined) {
  return Boolean(
    mimeType?.startsWith("image/") ||
    mimeType?.startsWith("video/") ||
    mimeType?.startsWith("audio/") ||
    mimeType?.includes("pdf"),
  );
}

function usesDirectResourceUrl(mimeType: string | undefined) {
  return Boolean(
    mimeType === "text/html" ||
    mimeType?.startsWith("video/") ||
    mimeType?.startsWith("audio/") ||
    mimeType?.includes("pdf"),
  );
}

// Only agent-authored Markdown artifacts (plans, notes, ...) are editable in
// place; uploaded sources stay read-only and binary previews have no text body.
function isEditableMarkdown(artifact: ConversationDocumentDetail | null) {
  return artifact?.kind === "artifact" && artifact.mime_type === "text/markdown";
}

export function ChatDocumentArtifactPanel({ onClose }: { onClose?: () => void }) {
  const { artifactPreview, closeArtifactPreview } = useChatStore(
    useShallow((s) => ({
      artifactPreview: s.artifactPreview,
      closeArtifactPreview: s.closeArtifactPreview,
    })),
  );
  const handleClose = onClose ?? closeArtifactPreview;
  const { open, conversationId, documentId, token } = artifactPreview;
  const [artifact, setArtifact] = useState<ConversationDocumentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [downloading, setDownloading] = useState(false);
  // The debounce timer, the latest draft, and the last persisted content are
  // read from the timer callback / unmount flush, so they live in refs to stay
  // current without re-arming the timer on every keystroke.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef("");
  const savedContentRef = useRef<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const binarySource = needsBinarySource(artifact?.mime_type);
  const directResource = usesDirectResourceUrl(artifact?.mime_type);
  const blobSource = binarySource && !directResource;
  const editable = isEditableMarkdown(artifact);
  const {
    blobUrl,
    loading: blobLoading,
    error: blobError,
  } = useDocumentBlobUrl(
    conversationId ?? undefined,
    documentId,
    Boolean(open && blobSource),
    artifact?.updated_at ?? "",
  );
  const {
    resourceUrl,
    loading: resourceLoading,
    error: resourceError,
  } = useDocumentResourceUrl(documentId, Boolean(open && directResource), artifact?.updated_at ?? "");
  const previewSrc = directResource ? resourceUrl : blobUrl;

  useEffect(() => {
    if (!open || !conversationId || !documentId) {
      setArtifact(null);
      return;
    }
    let active = true;
    setLoading(true);
    setArtifact(null);
    setSaveState("idle");
    void fetchConversationDocument(conversationId, documentId)
      .then((document) => {
        if (!active) {
          return;
        }
        setArtifact(document);
        const content = document.content_md ?? "";
        setDraft(content);
        draftRef.current = content;
        savedContentRef.current = content;
      })
      .catch(() => {
        if (!active) {
          return;
        }
        setArtifact(null);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [conversationId, documentId, open, token]);

  const previewLoading =
    loading || Boolean(artifact && blobSource && blobLoading) || Boolean(artifact && directResource && resourceLoading);
  const previewFailed = Boolean(blobError) || Boolean(resourceError);
  const isHtmlPreview = artifact?.mime_type === "text/html";

  useEffect(() => {
    const sync = () => {
      const root = panelRef.current;
      if (!root) {
        setIsFullscreen(false);
        return;
      }
      const el = document.fullscreenElement;
      setIsFullscreen(Boolean(el && (el === root || root.contains(el))));
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    if (open && isHtmlPreview) {
      return;
    }
    const el = document.fullscreenElement;
    if (el && panelRef.current?.contains(el)) {
      void document.exitFullscreen();
    }
  }, [isHtmlPreview, open]);

  const toggleFullscreen = useCallback(async () => {
    const root = panelRef.current;
    if (!root) {
      return;
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await root.requestFullscreen();
      }
    } catch {
      // Fullscreen API may reject without a user gesture or in unsupported contexts.
    }
  }, []);

  const downloadArtifact = useCallback(async () => {
    if (!artifact || !conversationId || !documentId) {
      return;
    }
    setDownloading(true);
    try {
      await downloadConversationDocument(
        conversationId,
        documentId,
        artifact,
        editable ? draftRef.current : artifact.content_md,
      );
    } catch (error) {
      toast.error(getErrorMessage(error, "下载失败"));
    } finally {
      setDownloading(false);
    }
  }, [artifact, conversationId, documentId, editable]);

  const runSave = useCallback(async (cid: string, did: string, content: string) => {
    setSaveState("saving");
    try {
      const updated = await updateConversationDocument(cid, did, {
        content_md: content,
      });
      savedContentRef.current = content;
      setArtifact((prev) => (prev && prev.id === updated.id ? { ...prev, updated_at: updated.updated_at } : prev));
      // A newer keystroke may have re-armed the timer while this PATCH was in
      // flight; only claim "saved" if the persisted content is still current.
      setSaveState((state) => (state === "saving" && draftRef.current === content ? "saved" : state));
    } catch {
      // apiHttp's interceptor already surfaces the error toast.
      setSaveState("error");
    }
  }, []);

  function handleDraftChange(value: string) {
    setDraft(value);
    draftRef.current = value;
    if (!conversationId || !documentId) {
      return;
    }
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    if (value === savedContentRef.current) {
      saveTimerRef.current = null;
      setSaveState("idle");
      return;
    }
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void runSave(conversationId, documentId, draftRef.current);
    }, AUTOSAVE_DELAY_MS);
  }

  // Switching artifact / closing the panel / unmounting must not silently drop
  // a debounced edit still waiting on its timer — flush it immediately.
  useEffect(() => {
    return () => {
      if (!saveTimerRef.current) {
        return;
      }
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (conversationId && documentId && draftRef.current !== savedContentRef.current) {
        void runSave(conversationId, documentId, draftRef.current);
      }
    };
  }, [conversationId, documentId, token, runSave]);

  return (
    <div ref={panelRef} className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{artifact?.title ?? (previewLoading ? "加载中…" : "预览")}</p>
          {artifact ? (
            <p className="truncate text-xs text-muted-foreground">
              {artifact.filename} · {artifact.mime_type}
            </p>
          ) : null}
        </div>
        {editable && saveState !== "idle" ? (
          <span className="shrink-0 text-xs text-muted-foreground" role="status" aria-live="polite">
            {saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : "保存失败"}
          </span>
        ) : null}
        {artifact ? (
          <ArtifactAction
            tooltip={downloading ? "下载中…" : "下载"}
            label="下载产物"
            aria-label={downloading ? "下载中" : "下载产物"}
            disabled={downloading}
            onClick={() => void downloadArtifact()}
          >
            {downloading ? <Loader2Icon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
          </ArtifactAction>
        ) : null}
        {isHtmlPreview && !previewLoading && !previewFailed ? (
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
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {previewLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">加载中…</div>
        ) : editable && artifact ? (
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <MarkdownEditor
              key={`${documentId}:${token}`}
              value={draft}
              contentType="markdown"
              editable
              onChange={handleDraftChange}
              className="h-full w-full overflow-y-auto"
            />
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
            content={artifact.content_md}
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
