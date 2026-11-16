import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  Button,
} from "@repo/design-system";
import { CodeEditor } from "@repo/editors/code-editor";
import type { DesktopBridge, LocalDirectoryEntry, LocalFile } from "@repo/runtime/desktop";
import { getErrorMessage } from "@repo/shared";
import { FileCode2Icon, RotateCcwIcon, SaveIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";

import { LocalFileBrowser } from "./LocalFileBrowser";

export function LocalFiles({
  bridge,
  id,
  initialPath,
  onDirtyChange,
}: {
  bridge: DesktopBridge;
  id: string;
  initialPath?: string | null;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [directory, setDirectory] = useState(".");
  const [entries, setEntries] = useState<LocalDirectoryEntry[] | null>(null);
  const [selected, setSelected] = useState<{ path: string; file: LocalFile; draft: string } | null>(null);
  const latest = useRef(selected);
  const openedInitialPath = useRef<string | null>(null);
  latest.current = selected;
  const [error, setError] = useState<string | null>(null);
  const [changed, setChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [visible, setVisible] = useState(100);
  const dirty = selected !== null && selected.draft !== selected.file.content;
  const blocker = useBlocker(dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    let mounted = true;
    setEntries(null);
    setVisible(100);
    void bridge
      .listFiles(id, directory)
      .then((value) => {
        if (mounted) setEntries(value);
      })
      .catch((err) => {
        if (mounted) setError(getErrorMessage(err));
      });
    return () => {
      mounted = false;
    };
  }, [bridge, id, directory, revision]);
  useEffect(
    () =>
      bridge.subscribe((event) => {
        if (event.type === "files" && event.threadId === id) setChanged(true);
      }),
    [bridge, id],
  );
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (latest.current && latest.current.draft !== latest.current.file.content) event.preventDefault();
    };
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, []);
  const open = useCallback(
    async (path: string) => {
      setError(null);
      try {
        const file = await bridge.readFile(id, path);
        setSelected({ path, file, draft: file.content });
        setChanged(false);
      } catch (err) {
        setError(getErrorMessage(err));
      }
    },
    [bridge, id],
  );
  useEffect(() => {
    if (!initialPath || dirty || openedInitialPath.current === initialPath) return;
    openedInitialPath.current = initialPath;
    const parent = initialPath.split("/").slice(0, -1).join("/") || ".";
    setDirectory(parent);
    void open(initialPath);
  }, [dirty, initialPath, open]);
  async function save() {
    if (!selected || saving) return;
    setSaving(true);
    setError(null);
    const savingFile = selected;
    try {
      const result = await bridge.writeFile(id, selected.path, selected.draft, selected.file.hash);
      setSelected((current) =>
        current?.path === savingFile.path
          ? { ...current, file: { content: savingFile.draft, hash: result.hash } }
          : current,
      );
      setChanged(false);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <AlertDialog
        open={blocker.state === "blocked"}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>离开前放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>当前草稿尚未写入磁盘。继续编辑可以保留草稿。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => blocker.reset?.()}>继续编辑</AlertDialogCancel>
            <AlertDialogAction onClick={() => blocker.proceed?.()}>放弃并离开</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <LocalFileBrowser
        directory={directory}
        entries={entries}
        selectedPath={selected?.path ?? null}
        dirty={dirty}
        visible={visible}
        onDirectoryChange={setDirectory}
        onOpen={(path) => void open(path)}
        onRefresh={() => setRevision((n) => n + 1)}
        onShowMore={() => setVisible((n) => n + 100)}
      />
      {error ? (
        <p
          role="alert"
          className="mx-3 mb-3 rounded-lg border border-destructive/30 bg-background px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
      {changed ? (
        <p role="status" className="mx-3 mb-3 rounded-lg border bg-background px-3 py-2 text-xs text-muted-foreground">
          磁盘文件有变更。重新读取后可查看最新内容；未保存的草稿会保留。
        </p>
      ) : null}
      {selected ? (
        <section
          aria-label="文件编辑器"
          className="mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border bg-background"
        >
          <div className="flex min-h-12 flex-wrap items-center gap-2 border-b px-3 py-2">
            <FileCode2Icon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium" title={selected.path}>
                {selected.path.split("/").at(-1)}
              </p>
              <p className="truncate text-xs text-muted-foreground" title={selected.path}>
                {selected.path}
                {dirty ? " · 未保存" : ""}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              disabled={dirty || saving}
              onClick={() => void open(selected.path)}
            >
              <RotateCcwIcon />
              重新读取
            </Button>
            <Button size="sm" className="gap-1.5" disabled={!dirty || saving} onClick={() => void save()}>
              <SaveIcon />
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
          {dirty ? (
            <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1">保存或撤销草稿后可切换文件。</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2"
                disabled={saving}
                onClick={() => setSelected({ ...selected, draft: selected.file.content })}
              >
                <RotateCcwIcon />
                撤销草稿
              </Button>
            </div>
          ) : null}
          <CodeEditor
            className="min-h-0 flex-1"
            fileId={`${id}:${selected.path}`}
            fileName={selected.path}
            value={selected.draft}
            onChange={(draft) => setSelected((current) => (current ? { ...current, draft } : current))}
            onSave={() => void save()}
          />
        </section>
      ) : (
        <div className="mx-3 mb-3 flex min-h-40 flex-1 flex-col items-center justify-center rounded-xl border border-dashed bg-background px-6 text-center">
          <span className="mb-3 flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <FileCode2Icon className="size-5" />
          </span>
          <p className="text-sm font-medium">选择一个文件开始编辑</p>
          <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
            保存后，Agent 会在下一步工作中感知这些修改。
          </p>
        </div>
      )}
    </div>
  );
}
