import { Skeleton } from "@repo/design-system";
import { getDesktopBridge } from "@repo/runtime/desktop";
import type { LocalThread } from "@repo/runtime/desktop";
import { getErrorMessage } from "@repo/shared";
import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

import { useLocalWorkspaceStore } from "../../stores/useLocalWorkspaceStore";
import { LocalSession } from "./LocalSession";
import { LocalChatTransport } from "./transport";

export function Component() {
  const bridge = getDesktopBridge();
  const { id } = useParams();
  const [loaded, setLoaded] = useState<{ thread: LocalThread; transport: LocalChatTransport } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const openWorkspace = useLocalWorkspaceStore((state) => state.openWorkspace);
  const resetWorkspace = useLocalWorkspaceStore((state) => state.reset);
  useEffect(() => {
    resetWorkspace();
    return resetWorkspace;
  }, [id, resetWorkspace]);
  useEffect(() => {
    if (!bridge || !id) return;
    let mounted = true;
    let activeLoaded = false;
    const transport = new LocalChatTransport(bridge, id);
    setLoaded(null);
    setError(null);
    const load = () =>
      void transport
        .load()
        .then((thread) => {
          if (mounted) {
            activeLoaded = true;
            setError(null);
            setLoaded({ thread, transport });
          } else transport.dispose();
        })
        .catch((cause) => {
          if (mounted) setError(getErrorMessage(cause));
        });
    load();
    const off = bridge.subscribe((event) => {
      if (event.type === "runtime-ready" && !activeLoaded) load();
    });
    return () => {
      mounted = false;
      off();
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
      {error ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {error}
        </p>
      ) : loaded?.thread.id === id ? (
        <LocalSession
          key={id}
          bridge={bridge}
          initial={loaded.thread}
          transport={loaded.transport}
          onOpenFiles={() => openWorkspace(id)}
          onOpenFile={(path) => openWorkspace(id, path)}
        />
      ) : (
        <Skeleton className="m-6 h-32" />
      )}
    </div>
  );
}
