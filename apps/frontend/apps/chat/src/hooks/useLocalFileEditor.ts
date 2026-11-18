import type {
  FileArtifactEditor,
  FileArtifactSaveState,
} from "@repo/ai-elements/conversation/components/FileArtifactPanel";
import { registerArtifactNavigationGuard } from "@repo/ai-elements/conversation/store/artifactNavigationGuard";
import type { DesktopBridge, LocalFile } from "@repo/runtime/desktop";
import { getErrorMessage } from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";

export function useLocalFileEditor(bridge: DesktopBridge, threadId: string, path: string) {
  const [file, setFile] = useState<LocalFile | null>(null);
  const [savedContent, setSavedContent] = useState("");
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saveState, setSaveState] = useState<FileArtifactSaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmingNavigation, setConfirmingNavigation] = useState(false);
  const [reload, setReload] = useState(0);
  const state = useRef({ file: null as LocalFile | null, draft: "", saved: "" });
  const generation = useRef(0);
  const pending = useRef<Promise<boolean> | null>(null);
  const resolver = useRef<((allowed: boolean) => void) | null>(null);
  const dirty = file !== null && draft !== savedContent;

  useEffect(() => {
    const current = ++generation.current;
    state.current = { file: null, draft: "", saved: "" };
    setFile(null);
    setSavedContent("");
    setDraft("");
    setEditing(false);
    setSaveState("idle");
    setError(null);
    setLoading(true);
    void bridge
      .readFile(threadId, path)
      .then((loaded) => {
        if (generation.current !== current) return;
        state.current = { file: loaded, draft: loaded.content, saved: loaded.content };
        setFile(loaded);
        setSavedContent(loaded.content);
        setDraft(loaded.content);
      })
      .catch((cause) => {
        if (generation.current === current) setError(getErrorMessage(cause, "无法加载文件"));
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      ++generation.current;
    };
  }, [bridge, threadId, path, reload]);

  const beginEditing = useCallback(async () => {
    if (state.current.file) setEditing(true);
  }, []);
  const runSave = useCallback(async (): Promise<boolean> => {
    if (pending.current) return pending.current;
    const current = state.current;
    if (!current.file) return false;
    if (current.draft === current.saved) return true;
    const savedDraft = current.draft;
    const expectedHash = current.file.hash;
    const currentGeneration = generation.current;
    setSaveState("saving");
    setError(null);
    const task = bridge
      .writeFile(threadId, path, savedDraft, expectedHash)
      .then((result) => {
        if (generation.current !== currentGeneration) return false;
        const updated = { content: savedDraft, hash: result.hash };
        state.current.file = updated;
        state.current.saved = savedDraft;
        setFile(updated);
        setSavedContent(savedDraft);
        const allSaved = state.current.draft === savedDraft;
        setSaveState(allSaved ? "saved" : "dirty");
        return allSaved;
      })
      .catch((cause: unknown) => {
        if (generation.current !== currentGeneration) return false;
        setSaveState("error");
        setError(getErrorMessage(cause, "保存失败，草稿已保留"));
        return false;
      })
      .finally(() => {
        pending.current = null;
      });
    pending.current = task;
    return task;
  }, [bridge, path, threadId]);
  const requestNavigation = useCallback(async (): Promise<boolean> => {
    if (pending.current) await pending.current;
    if (!state.current.file || state.current.draft === state.current.saved) return true;
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
  useEffect(
    () =>
      bridge.subscribe((event) => {
        if (
          event.type !== "files" ||
          event.threadId !== threadId ||
          (!event.paths.includes(path) && !event.paths.includes("."))
        ) {
          return;
        }
        if (state.current.file && state.current.draft !== state.current.saved) {
          setError("磁盘文件有变更。草稿已保留，请重新加载后再编辑。");
          return;
        }
        setReload((value) => value + 1);
      }),
    [bridge, path, threadId],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (state.current.file && state.current.draft !== state.current.saved) event.preventDefault();
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
  const editor: FileArtifactEditor = {
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
  return { file, savedContent, editor };
}
