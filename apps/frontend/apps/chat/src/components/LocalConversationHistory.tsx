import { Button, SidebarMenu, SidebarMenuItem, buttonVariants } from "@repo/design-system";
import { getDesktopBridge, type LocalThread } from "@repo/runtime/desktop";
import { cn, getErrorMessage } from "@repo/shared";
import { MonitorIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

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
          if (mounted) setThreads(items);
        })
        .catch((cause) => {
          if (mounted) setError(getErrorMessage(cause));
        });
    load();
    const off = bridge.subscribe((event) => {
      if (event.type === "thread") load();
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
      <SidebarMenu aria-label="本地会话列表">
        {threads.slice(0, limit).map((thread) => {
          const active = pathname === `/platform/chat/local/${thread.id}`;
          return (
            <SidebarMenuItem key={thread.id}>
              <Link
                to={`/platform/chat/local/${thread.id}`}
                aria-current={active ? "page" : undefined}
                onClick={onSelect}
                className={cn(
                  buttonVariants({ variant: active ? "secondary" : "ghost" }),
                  "h-9 w-full min-w-0 justify-start gap-2 pr-9 text-sm font-normal",
                )}
              >
                <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{thread.title}</span>
              </Link>
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
            </SidebarMenuItem>
          );
        })}
        {threads.length > limit ? (
          <SidebarMenuItem>
            <Button variant="ghost" onClick={() => setLimit((n) => n + 40)}>
              显示更早的本地会话
            </Button>
          </SidebarMenuItem>
        ) : null}
      </SidebarMenu>
    </>
  );
}
