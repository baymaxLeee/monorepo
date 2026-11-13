import { Button, Sheet, SheetContent, SheetHeader, SheetTitle, Skeleton } from "@repo/design-system";
import { getDesktopBridge } from "@repo/runtime/desktop";
import type { LocalThread } from "@repo/runtime/desktop";
import { getErrorMessage } from "@repo/shared";
import { FolderIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

import { LocalFiles } from "./LocalFiles";
import { LocalMessages } from "./LocalMessages";
import { LocalChatTransport } from "./transport";

export function Component() {
  const bridge = getDesktopBridge();
  const { id } = useParams();
  const [loaded, setLoaded] = useState<{ thread: LocalThread; transport: LocalChatTransport } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [closeBlocked, setCloseBlocked] = useState(false);
  useEffect(() => {
    if (!bridge || !id) return;
    let mounted = true;
    const transport = new LocalChatTransport(bridge, id);
    setLoaded(null);
    setError(null);
    setFiles(false);
    setDirty(false);
    setCloseBlocked(false);
    void transport
      .load()
      .then((thread) => {
        if (mounted) setLoaded({ thread, transport });
        else transport.dispose();
      })
      .catch((cause) => {
        if (mounted) setError(getErrorMessage(cause));
      });
    return () => {
      mounted = false;
      transport.dispose();
    };
  }, [bridge, id]);
  if (!id) return <Navigate to="/platform/chat/conversations" replace />;
  if (!bridge)
    return (
      <p role="alert" className="p-14 text-sm">
        请使用桌面应用打开此本地会话。
      </p>
    );
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center justify-center gap-2 px-14">
        <h1 className="max-w-full truncate text-sm font-medium">{loaded?.thread.title ?? "本地会话"}</h1>
        <Button variant="ghost" size="icon-sm" aria-label="查看本地文件" onClick={() => setFiles(true)}>
          <FolderIcon />
        </Button>
      </header>
      {error ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {error}
        </p>
      ) : loaded?.thread.id === id ? (
        <LocalMessages key={id} bridge={bridge} initial={loaded.thread} transport={loaded.transport} />
      ) : (
        <Skeleton className="m-6 h-32" />
      )}
      <Sheet
        open={files}
        onOpenChange={(open) => {
          if (!open && dirty) {
            setCloseBlocked(true);
            return;
          }
          setFiles(open);
          setCloseBlocked(false);
        }}
      >
        <SheetContent className="w-full sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>本地文件</SheetTitle>
          </SheetHeader>
          {closeBlocked ? (
            <p role="alert" className="px-4 text-sm text-muted-foreground">
              请先保存或撤销草稿，再关闭文件面板。
            </p>
          ) : null}
          {files ? <LocalFiles key={id} bridge={bridge} id={id} onDirtyChange={setDirty} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
