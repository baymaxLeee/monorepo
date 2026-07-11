import type { ConversationDocumentDetail } from "api";
import { fetchConversationDocument, updateConversationDocument } from "api";
import { Button } from "components";
import { ArtifactPreview } from "components/ai-chat";
import { MarkdownEditor } from "components/markdown-editor";
import { XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  fetchCachedDocumentSource,
  useDocumentBlobUrl,
} from "../hooks/useDocumentSource";
import { prepareArtifactPreviewHtml } from "../lib/prepareArtifactPreviewHtml";
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

// Only agent-authored Markdown artifacts (plans, notes, ...) are editable in
// place; uploaded sources stay read-only and binary previews have no text body.
function isEditableMarkdown(artifact: ConversationDocumentDetail | null) {
  return (
    artifact?.kind === "artifact" && artifact.mime_type === "text/markdown"
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
  const [draft, setDraft] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // The debounce timer, the latest draft, and the last persisted content are
  // read from the timer callback / unmount flush, so they live in refs to stay
  // current without re-arming the timer on every keystroke.
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftRef = useRef("");
  const savedContentRef = useRef<string | null>(null);
  const binarySource = needsBinarySource(artifact?.mime_type);
  const editable = isEditableMarkdown(artifact);
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
    setSaveState("idle");
    void fetchConversationDocument(conversationId, documentId)
      .then((document) => {
        if (!active) return;
        setArtifact(document);
        const content = document.content_md ?? "";
        setDraft(content);
        draftRef.current = content;
        savedContentRef.current = content;
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
        if (active) setPreviewHtml(prepareArtifactPreviewHtml(html));
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
  }, [
    artifact?.mime_type,
    artifact?.updated_at,
    conversationId,
    documentId,
    open,
  ]);

  const previewLoading =
    loading ||
    sourceLoading ||
    Boolean(artifact && binarySource && blobLoading);
  const previewFailed = sourceError || Boolean(blobError);

  const runSave = useCallback(
    async (cid: string, did: string, content: string) => {
      setSaveState("saving");
      try {
        const updated = await updateConversationDocument(cid, did, {
          content_md: content,
        });
        savedContentRef.current = content;
        setArtifact((prev) =>
          prev && prev.id === updated.id
            ? { ...prev, updated_at: updated.updated_at }
            : prev,
        );
        // A newer keystroke may have re-armed the timer while this PATCH was in
        // flight; only claim "saved" if the persisted content is still current.
        setSaveState((state) =>
          state === "saving" && draftRef.current === content ? "saved" : state,
        );
      } catch {
        // apiHttp's interceptor already surfaces the error toast.
        setSaveState("error");
      }
    },
    [],
  );

  function handleDraftChange(value: string) {
    setDraft(value);
    draftRef.current = value;
    if (!conversationId || !documentId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
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
      if (!saveTimerRef.current) return;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
      if (
        conversationId &&
        documentId &&
        draftRef.current !== savedContentRef.current
      ) {
        void runSave(conversationId, documentId, draftRef.current);
      }
    };
  }, [conversationId, documentId, token, runSave]);

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
        {editable && saveState !== "idle" ? (
          <span
            className="shrink-0 text-xs text-muted-foreground"
            role="status"
            aria-live="polite"
          >
            {saveState === "saving"
              ? "保存中…"
              : saveState === "saved"
                ? "已保存"
                : "保存失败"}
          </span>
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
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            加载中…
          </div>
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
            content={previewHtml ?? artifact.content_md}
            src={previewSrc ?? undefined}
            trustedHtml={
              artifact.mime_type === "text/html" && previewHtml !== null
            }
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
