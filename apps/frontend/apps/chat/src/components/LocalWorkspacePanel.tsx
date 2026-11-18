import { Button } from "@repo/design-system";
import { getDesktopBridge } from "@repo/runtime/desktop";
import { FilesIcon, XIcon } from "lucide-react";

import { LocalFiles } from "../pages/local/LocalFiles";
import { useLocalWorkspaceStore } from "../stores/useLocalWorkspaceStore";
import { LocalFileArtifactPanel } from "./LocalFileArtifactPanel";

export function LocalWorkspacePanel() {
  const bridge = getDesktopBridge();
  const { threadId, path, requestClose, openWorkspace } = useLocalWorkspaceStore();
  if (!bridge || !threadId) {
    return <p className="p-4 text-sm text-destructive">本地工作区不可用。</p>;
  }
  if (path) {
    return <LocalFileArtifactPanel bridge={bridge} threadId={threadId} path={path} onClose={requestClose} />;
  }
  return (
    <aside aria-label="本地文件" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-muted/20">
      <div className="flex h-14 shrink-0 items-center gap-3 px-4">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">
          <FilesIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <h2 className="truncate text-sm font-medium">工作区文件</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">{path ? path : "浏览和编辑 Agent 可访问的文件"}</p>
        </div>
        <Button variant="ghost" size="icon-sm" className="rounded-lg" aria-label="关闭本地文件" onClick={requestClose}>
          <XIcon />
        </Button>
      </div>
      <LocalFiles key={threadId} bridge={bridge} id={threadId} onOpen={(next) => openWorkspace(threadId, next)} />
    </aside>
  );
}
