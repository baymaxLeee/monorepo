import { Button, Skeleton } from "@repo/design-system";
import type { LocalDirectoryEntry } from "@repo/runtime/desktop";
import { ArrowLeftIcon, ChevronRightIcon, FileCode2Icon, FolderClosedIcon, RefreshCwIcon } from "lucide-react";

export function LocalFileBrowser({
  directory,
  entries,
  selectedPath,
  dirty,
  visible,
  onDirectoryChange,
  onOpen,
  onRefresh,
  onShowMore,
}: {
  directory: string;
  entries: LocalDirectoryEntry[] | null;
  selectedPath: string | null;
  dirty: boolean;
  visible: number;
  onDirectoryChange: (path: string) => void;
  onOpen: (path: string) => void;
  onRefresh: () => void;
  onShowMore: () => void;
}) {
  const directoryName = directory === "." ? "项目文件" : (directory.split("/").at(-1) ?? directory);
  const parent = directory.split("/").slice(0, -1).join("/") || ".";

  return (
    <section aria-label="文件浏览器" className="shrink-0 px-3 pb-3">
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex h-10 items-center gap-1 border-b px-2">
          {directory !== "." ? (
            <Button variant="ghost" size="icon-sm" aria-label="返回上级目录" onClick={() => onDirectoryChange(parent)}>
              <ArrowLeftIcon />
            </Button>
          ) : null}
          <div className="flex min-w-0 flex-1 items-center gap-2 px-1">
            <FolderClosedIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate text-sm font-medium" title={directory}>
              {directoryName}
            </span>
            {directory !== "." ? <span className="truncate text-xs text-muted-foreground">{directory}</span> : null}
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="刷新目录" onClick={onRefresh}>
            <RefreshCwIcon />
          </Button>
        </div>

        <div className="max-h-56 overflow-auto p-1.5">
          {entries === null ? (
            <div className="space-y-1 p-1" aria-label="正在加载目录">
              <Skeleton className="h-8 w-full rounded-lg" />
              <Skeleton className="h-8 w-4/5 rounded-lg" />
              <Skeleton className="h-8 w-3/5 rounded-lg" />
            </div>
          ) : entries.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">这个目录是空的</p>
          ) : (
            entries.slice(0, visible).map((entry) => {
              const path = directory === "." ? entry.name : `${directory}/${entry.name}`;
              const selected = selectedPath === path;
              return (
                <Button
                  key={entry.name}
                  variant="ghost"
                  size="sm"
                  aria-current={selected ? "page" : undefined}
                  className="group mb-0.5 w-full justify-start gap-2 rounded-lg px-2 font-normal aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
                  disabled={entry.symlink || (!entry.directory && dirty)}
                  title={entry.symlink ? "暂不支持打开符号链接" : entry.name}
                  onClick={() => (entry.directory ? onDirectoryChange(path) : onOpen(path))}
                >
                  {entry.directory ? (
                    <FolderClosedIcon className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <FileCode2Icon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-left">{entry.name}</span>
                  {entry.symlink ? <span className="text-xs text-muted-foreground">链接</span> : null}
                  {entry.directory ? (
                    <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground opacity-60 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
                  ) : null}
                </Button>
              );
            })
          )}
          {entries && entries.length > visible ? (
            <Button variant="ghost" size="sm" className="mt-1 w-full text-muted-foreground" onClick={onShowMore}>
              再显示 {Math.min(100, entries.length - visible)} 项
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
