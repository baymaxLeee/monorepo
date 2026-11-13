import { Button } from "@repo/design-system";
import { getDesktopBridge, type LocalThread } from "@repo/runtime/desktop";
import { getErrorMessage } from "@repo/shared";
import { MonitorIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ConversationHistoryList } from "./ConversationHistoryList";

export function LocalConversationHistory({ onSelect }: { onSelect: () => void }) {
  const bridge = getDesktopBridge();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [threads, setThreads] = useState<LocalThread[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(40);
  useEffect(() => {
    if (!bridge) return;
    let mounted = true;
    const load = () =>
      void bridge
        .listThreads()
        .then((items) => {
          if (mounted) {
            setError(null);
            setThreads(items);
          }
        })
        .catch((cause) => {
          if (mounted) setError(getErrorMessage(cause));
        });
    load();
    const off = bridge.subscribe((event) => {
      if (event.type === "thread") load();
      if (event.type === "runtime-ready") load();
      if (event.type === "runtime-error") setError(event.message);
    });
    return () => {
      mounted = false;
      off();
    };
  }, [bridge, pathname]);
  return (
    <>
      <p role={error ? "alert" : undefined} className="text-xs text-destructive">
        {error}
      </p>
      <ConversationHistoryList
        label="本地会话列表"
        onSelect={onSelect}
        items={threads.slice(0, limit).map((thread) => {
          const active = pathname === `/platform/chat/local/${thread.id}`;
          return {
            key: thread.id,
            href: `/platform/chat/local/${thread.id}`,
            title: thread.title,
            active,
            icon: <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />,
            actions: (
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1"
                aria-label={`删除本地会话 ${thread.title}`}
                onClick={() =>
                  void bridge
                    ?.removeThread(thread.id)
                    .then(async () => {
                      setThreads(await bridge.listThreads());
                      if (active) void navigate("/platform/chat/conversations");
                    })
                    .catch((cause) => setError(getErrorMessage(cause)))
                }
              >
                <Trash2Icon />
              </Button>
            ),
          };
        })}
        onLoadMore={threads.length > limit ? () => setLimit((n) => n + 40) : undefined}
        loadMoreLabel="显示更早的本地会话"
      />
    </>
  );
}
