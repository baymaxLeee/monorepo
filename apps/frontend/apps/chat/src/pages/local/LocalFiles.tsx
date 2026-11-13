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
  Skeleton,
} from "@repo/design-system";
import { CodeEditor } from "@repo/editors/code-editor";
import type { DesktopBridge, LocalDirectoryEntry, LocalFile } from "@repo/runtime/desktop";
import { getErrorMessage } from "@repo/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";

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
    <aside className="flex min-h-0 w-full shrink-0 flex-col border-l" aria-label="本地文件">
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
      <div className="flex items-center justify-between gap-2 border-b p-3">
        <span className="truncate text-sm" title={directory}>
          {directory}
        </span>
        <Button variant="ghost" size="sm" onClick={() => setRevision((n) => n + 1)}>
          刷新目录
        </Button>
      </div>
      <div className="max-h-48 overflow-auto p-2">
        {directory !== "." ? (
          <Button
            variant="ghost"
            className="w-full justify-start"
            onClick={() => setDirectory(directory.split("/").slice(0, -1).join("/") || ".")}
          >
            上级目录
          </Button>
        ) : null}
        {entries === null ? (
          <Skeleton className="h-20" />
        ) : entries.length === 0 ? (
          <p className="p-2 text-sm text-muted-foreground">目录为空</p>
        ) : (
          entries.slice(0, visible).map((entry) => {
            const path = directory === "." ? entry.name : `${directory}/${entry.name}`;
            return (
              <Button
                key={entry.name}
                variant={selected?.path === path ? "secondary" : "ghost"}
                className="w-full justify-start truncate"
                disabled={entry.symlink || (!entry.directory && dirty)}
                onClick={() => (entry.directory ? setDirectory(path) : void open(path))}
              >
                {entry.directory ? "▸ " : ""}
                {entry.name}
              </Button>
            );
          })
        )}
        {entries && entries.length > visible ? (
          <Button variant="ghost" onClick={() => setVisible((n) => n + 100)}>
            显示更多
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {changed ? (
        <p role="status" className="p-3 text-xs text-muted-foreground">
          磁盘文件有变更。重新读取后可查看最新内容；未保存的草稿会保留。
        </p>
      ) : null}
      {selected ? (
        <>
          <div className="flex flex-wrap items-center gap-2 border-y p-2">
            <span className="min-w-0 flex-1 truncate text-xs" title={selected.path}>
              {selected.path}
              {dirty ? " · 未保存" : ""}
            </span>
            <Button size="sm" variant="outline" disabled={dirty || saving} onClick={() => void open(selected.path)}>
              重新读取
            </Button>
            <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
          {dirty ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              请先保存草稿再切换文件。可复制草稿后撤销修改，以读取磁盘上的版本。
              <Button
                variant="link"
                size="sm"
                disabled={saving}
                onClick={() => setSelected({ ...selected, draft: selected.file.content })}
              >
                撤销草稿
              </Button>
            </p>
          ) : null}
          <CodeEditor
            className="min-h-0 flex-1"
            fileId={`${id}:${selected.path}`}
            fileName={selected.path}
            value={selected.draft}
            onChange={(draft) => setSelected((current) => (current ? { ...current, draft } : current))}
            onSave={() => void save()}
          />
        </>
      ) : (
        <p className="p-4 text-sm text-muted-foreground">选择文本文件进行编辑。保存后 Agent 将感知变更。</p>
      )}
    </aside>
  );
}
