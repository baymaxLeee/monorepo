import { Button } from "@repo/design-system";
import { getDesktopBridge, type LocalThread } from "@repo/runtime/desktop";
import { getErrorMessage } from "@repo/shared";
import { ChevronDownIcon, FolderIcon, MessageSquareIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ConversationHistoryList } from "./ConversationHistoryList";

function workspaceName(path: string) {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .at(-1) || path
  );
}

export function LocalConversationHistory({ onSelect }: { onSelect: () => void }) {
  const bridge = getDesktopBridge();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [threads, setThreads] = useState<LocalThread[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(40);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const visibleThreads = threads.slice(0, limit);
  const projects = visibleThreads.reduce((groups, thread) => {
    const group = groups.get(thread.workspace);
    if (group) group.push(thread);
    else groups.set(thread.workspace, [thread]);
    return groups;
  }, new Map<string, LocalThread[]>());
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
      {error ? (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {projects.size > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-full justify-between px-2 text-xs font-medium text-muted-foreground"
          aria-expanded={projectsOpen}
          aria-controls="local-projects"
          onClick={() => setProjectsOpen((open) => !open)}
        >
          项目
          <ChevronDownIcon
            className={`size-3.5 transition-transform ${projectsOpen ? "rotate-0" : "-rotate-90"}`}
            aria-hidden="true"
          />
        </Button>
      ) : null}
      {projectsOpen ? (
        <div id="local-projects">
          {[...projects].map(([workspace, projectThreads]) => (
            <section key={workspace} aria-label={`项目 ${workspaceName(workspace)}`} className="mb-3">
              <div className="flex h-9 items-center gap-2 rounded-lg px-2 text-sm font-medium" title={workspace}>
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{workspaceName(workspace)}</span>
              </div>
              <div className="pl-2">
                <ConversationHistoryList
                  label={`${workspaceName(workspace)} 的本地会话`}
                  onSelect={onSelect}
                  items={projectThreads.map((thread) => {
                    const active = pathname === `/platform/chat/local/${thread.id}`;
                    return {
                      key: thread.id,
                      href: `/platform/chat/local/${thread.id}`,
                      title: thread.title,
                      active,
                      icon: <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" />,
                      actions: (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="absolute right-1 top-1 opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100"
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
                />
              </div>
            </section>
          ))}
          {threads.length > limit ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => setLimit((n) => n + 40)}
            >
              显示更早的本地会话
            </Button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
