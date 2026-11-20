import { Button } from "@repo/design-system";
import { ChevronDownIcon, FolderClosedIcon, FolderOpenIcon } from "lucide-react";
import { useState } from "react";

import { ConversationHistoryList, type ConversationHistoryItem } from "./ConversationHistoryList";

export interface ProjectHistoryItem extends ConversationHistoryItem {
  workspace: string;
  updatedAt: string;
}

const THREAD_PAGE_SIZE = 5;
const PROJECT_PAGE_SIZE = 40;

function ProjectGroup({
  workspace,
  threads,
  initiallyExpanded,
  onSelect,
}: {
  workspace: string;
  threads: ProjectHistoryItem[];
  initiallyExpanded: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const [limit, setLimit] = useState(THREAD_PAGE_SIZE);
  const name = workspace.split(/[\\/]/).filter(Boolean).at(-1) || workspace;
  const Folder = expanded ? FolderOpenIcon : FolderClosedIcon;
  return (
    <section aria-label={`项目 ${name}`}>
      <Button
        variant="ghost"
        className="h-[1.9375rem] w-full justify-start gap-2 border-0 px-2 text-sm font-normal text-sidebar-foreground/80 aria-expanded:bg-transparent aria-expanded:text-sidebar-foreground/80 aria-expanded:hover:bg-sidebar-accent"
        title={workspace}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <Folder strokeWidth={1.6} className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{name}</span>
      </Button>
      {expanded && (
        <div className="mb-2 pl-6">
          <ConversationHistoryList
            desktop
            label={`${name} 的本地会话`}
            onSelect={onSelect}
            items={threads.slice(0, limit)}
            loadMoreLabel="展开显示"
            onLoadMore={threads.length > limit ? () => setLimit((count) => count + THREAD_PAGE_SIZE) : undefined}
          />
        </div>
      )}
    </section>
  );
}

export function LocalProjectHistory({
  items,
  error,
  retry,
  onSelect,
}: {
  items: ProjectHistoryItem[];
  error: string | null;
  retry: () => void;
  onSelect: () => void;
}) {
  const [open, setOpen] = useState(true);
  const [limit, setLimit] = useState(PROJECT_PAGE_SIZE);
  const projects = new Map<string, ProjectHistoryItem[]>();
  for (const thread of items) {
    const group = projects.get(thread.workspace);
    if (group) group.push(thread);
    else projects.set(thread.workspace, [thread]);
  }
  if (!projects.size && !error) return null;
  const initialWorkspace = items.find((item) => item.active)?.workspace ?? items[0]?.workspace;
  return (
    <div className="mb-5">
      <Button
        variant="ghost"
        size="sm"
        className="group mb-0.5 h-8 w-full justify-start gap-1 border-0 px-2 text-sm font-medium text-muted-foreground aria-expanded:bg-transparent aria-expanded:text-muted-foreground aria-expanded:hover:bg-sidebar-accent"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        项目{" "}
        <ChevronDownIcon
          className={`size-3 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 ${open ? "" : "-rotate-90"}`}
          aria-hidden="true"
        />
      </Button>
      <div hidden={!open}>
        {error && (
          <div role="alert" className="px-2 text-sm text-muted-foreground">
            {error}
            <Button variant="link" onClick={retry}>
              重试
            </Button>
          </div>
        )}
        {[...projects].slice(0, limit).map(([workspace, items]) => (
          <ProjectGroup
            key={workspace}
            workspace={workspace}
            threads={items}
            initiallyExpanded={workspace === initialWorkspace}
            onSelect={onSelect}
          />
        ))}
        {projects.size > limit && (
          <Button variant="ghost" onClick={() => setLimit((n) => n + PROJECT_PAGE_SIZE)}>
            显示更多项目
          </Button>
        )}
      </div>
    </div>
  );
}
