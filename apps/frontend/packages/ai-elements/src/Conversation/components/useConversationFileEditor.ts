import { ApiError, createStorageDownloadUrl, fetchAssetText } from "@repo/api";
import { getConversationFile, type ConversationFile, updateConversationFileContent } from "@repo/api/chat";
import { getErrorMessage, randomId } from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { registerArtifactNavigationGuard } from "../store/artifactNavigationGuard";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "conflict" | "error";

export function useConversationFileEditor(
  conversationId: string | null,
  fileId: string | null,
  open: boolean,
  token: number,
) {
  const [file, setFile] = useState<ConversationFile | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingNavigation, setConfirmingNavigation] = useState(false);
  const [reload, setReload] = useState(0);
  const state = useRef({ file: null as ConversationFile | null, draft: "", saved: null as string | null });
  const epoch = useRef(0);
  const operation = useRef<{ content: string; etag: string; id: string } | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const resolver = useRef<((allowed: boolean) => void) | null>(null);
  const dirty = state.current.saved !== null && draft !== state.current.saved;

  useEffect(() => {
    const generation = ++epoch.current;
    const controller = new AbortController();
    state.current = { file: null, draft: "", saved: null };
    operation.current = null;
    setFile(null);
    setDraft("");
    setEditing(false);
    setSaveState("idle");
    setError(null);
    if (!open || !conversationId || !fileId) return;
    setLoading(true);
    void getConversationFile(conversationId, fileId, { signal: controller.signal })
      .then((metadata) => {
        if (epoch.current !== generation) return;
        state.current.file = metadata;
        setFile(metadata);
      })
      .catch((cause) => {
        if (!controller.signal.aborted) setError(getErrorMessage(cause, "无法加载文件"));
      })
      .finally(() => {
        if (epoch.current === generation) setLoading(false);
      });
    return () => {
      ++epoch.current;
      controller.abort();
    };
  }, [conversationId, fileId, open, token, reload]);

  const beginEditing = useCallback(async () => {
    if (state.current.saved !== null) {
      setEditing(true);
      return;
    }
    if (!conversationId || !fileId) return;
    const generation = epoch.current;
    setLoading(true);
    setError(null);
    try {
      const metadata = await getConversationFile(conversationId, fileId);
      if (!metadata.editable) throw new Error("此文件不支持编辑或超过文本编辑大小限制");
      const capability = await createStorageDownloadUrl({
        assetId: metadata.asset_id,
        revisionId: metadata.revision_id,
        owner: { kind: "conversation-file", conversationId, fileId },
      });
      const content = await fetchAssetText(capability.url, undefined, metadata.edit_max_bytes);
      if (epoch.current !== generation) return;
      state.current = { file: metadata, draft: content, saved: content };
      setFile(metadata);
      setDraft(content);
      setEditing(true);
    } catch (cause) {
      if (epoch.current === generation) setError(getErrorMessage(cause, "无法加载编辑内容，请重试"));
    } finally {
      if (epoch.current === generation) setLoading(false);
    }
  }, [conversationId, fileId]);

  const runSave = useCallback(async (): Promise<boolean> => {
    if (pending.current) return pending.current;
    const { file: current, draft: content, saved } = state.current;
    if (!current?.editable || !conversationId || !fileId || saved === null) return false;
    if (content === saved) return true;
    const generation = epoch.current;
    const request =
      operation.current?.content === content && operation.current.etag === current.etag
        ? operation.current
        : { content, etag: current.etag, id: randomId().replaceAll("-", "") };
    operation.current = request;
    setSaveState("saving");
    setError(null);
    const task = updateConversationFileContent(conversationId, fileId, {
      content,
      expected_etag: request.etag,
      operation_id: request.id,
    })
      .then((updated) => {
        if (epoch.current !== generation) return false;
        state.current.saved = content;
        state.current.file = updated;
        setFile(updated);
        operation.current = null;
        const allSaved = state.current.draft === content;
        setSaveState(allSaved ? "saved" : "dirty");
        return allSaved;
      })
      .catch((cause: unknown) => {
        if (epoch.current !== generation) return false;
        setSaveState(cause instanceof ApiError && cause.code === "file_content_conflict" ? "conflict" : "error");
        setError(getErrorMessage(cause, "保存失败，草稿已保留"));
        return false;
      })
      .finally(() => {
        pending.current = null;
      });
    pending.current = task;
    return task;
  }, [conversationId, fileId]);

  const requestNavigation = useCallback(async (): Promise<boolean> => {
    if (pending.current) await pending.current;
    if (state.current.saved === null || state.current.draft === state.current.saved) return true;
    if (resolver.current) return false;
    setConfirmingNavigation(true);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  const resolveNavigation = useCallback((allowed: boolean) => {
    const resolve = resolver.current;
    resolver.current = null;
    setConfirmingNavigation(false);
    resolve?.(allowed);
  }, []);
  useEffect(() => registerArtifactNavigationGuard(requestNavigation), [requestNavigation]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (state.current.saved !== null && state.current.draft !== state.current.saved) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
      resolver.current?.(false);
    };
  }, []);

  const changeDraft = useCallback((value: string) => {
    state.current.draft = value;
    setDraft(value);
    if (!pending.current) setSaveState(value === state.current.saved ? "idle" : "dirty");
  }, []);
  const reloadFile = useCallback(async () => {
    if (await requestNavigation()) setReload((value) => value + 1);
  }, [requestNavigation]);
  return {
    file,
    loading,
    draft,
    dirty,
    editing,
    setEditing,
    saveState,
    error,
    confirmingNavigation,
    beginEditing,
    changeDraft,
    runSave,
    requestNavigation,
    resolveNavigation,
    reloadFile,
  };
}
