import { buttonVariants, Skeleton } from "@repo/design-system";
import { getDesktopBridge, type LocalThread } from "@repo/runtime/desktop";
import { cn, getErrorMessage } from "@repo/shared";
import { SparklesIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { LocalSession } from "./LocalSession";
import { LocalChatTransport } from "./transport";

interface LocalSessionRenderProps {
  bridge: NonNullable<ReturnType<typeof getDesktopBridge>>;
  thread: LocalThread;
  transport: LocalChatTransport;
}

const renderDefaultSession = ({ bridge, thread, transport }: LocalSessionRenderProps) => (
  <div className="relative h-full min-h-0">
    <Link
      to={`/platform/chat/local/${thread.id}/agent-ui`}
      className={cn(
        buttonVariants({ size: "sm", variant: "outline" }),
        "absolute right-3 top-3 z-20 gap-2 bg-background/90 backdrop-blur",
      )}
    >
      <SparklesIcon className="size-4" aria-hidden="true" />
      Agent UI
    </Link>
    <LocalSession bridge={bridge} initial={thread} transport={transport} />
  </div>
);

export function LocalSessionRoute({
  uiAgent = false,
  renderSession = renderDefaultSession,
}: {
  uiAgent?: boolean;
  renderSession?: (props: LocalSessionRenderProps) => ReactNode;
}) {
  const bridge = getDesktopBridge();
  const { id } = useParams();
  const [loaded, setLoaded] = useState<{ thread: LocalThread; transport: LocalChatTransport } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge || !id) return;
    let mounted = true;
    let activeLoaded = false;
    const transport = new LocalChatTransport(bridge, id, uiAgent);
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
  }, [bridge, id, uiAgent]);

  if (!id) return <Navigate to="/platform/chat/conversations" replace />;
  if (!bridge) {
    return (
      <p role="alert" className="p-14 text-sm">
        请使用桌面应用打开此本地会话。
      </p>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {error ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {error}
        </p>
      ) : loaded?.thread.id === id ? (
        renderSession({ bridge, thread: loaded.thread, transport: loaded.transport })
      ) : (
        <Skeleton className="m-6 h-32" />
      )}
    </div>
  );
}

export function Component() {
  return <LocalSessionRoute />;
}
