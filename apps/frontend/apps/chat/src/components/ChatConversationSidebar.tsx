import type { Conversation } from "api";
import {
  Aside,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Section,
  Skeleton,
} from "components";
import {
  BoxesIcon,
  DownloadIcon,
  MessageSquareIcon,
  MoreHorizontalIcon,
  PanelLeftIcon,
  PlusIcon,
  RouteIcon,
  Trash2Icon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "shared";
import { ChatPanelResizeHandle } from "./ChatPanelResizeHandle";
import { ChatUserMenu } from "./ChatUserMenu";

export type ChatConversationSidebarProps = {
  conversations: Conversation[] | null;
  activePath: string;
  creating: boolean;
  open: boolean;
  width: number;
  compact: boolean;
  showToggle: boolean;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onOpenTrace: (id: string) => void;
  onToggle: () => void;
  onResize: (deltaX: number) => void;
  onResizeStart: () => void;
  onResizeEnd: () => void;
  resizeMin?: number;
  resizeMax?: number;
};

export function ChatConversationSidebar({
  conversations,
  activePath,
  creating,
  open,
  width,
  compact,
  showToggle,
  onCreate,
  onDelete,
  onExport,
  onOpenTrace,
  onToggle,
  onResize,
  onResizeStart,
  onResizeEnd,
  resizeMin,
  resizeMax,
}: ChatConversationSidebarProps) {
  return (
    <>
      <Aside
        className={cn(
          "relative z-10 w-full min-w-0 gap-2 overflow-visible !border-r-0 bg-background p-1.5",
          compact && "absolute inset-y-0 left-0 z-30 shadow-xl",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={compact && open ? { width } : undefined}
        aria-hidden={!open}
      >
        <div className="relative flex h-full min-w-0 flex-col gap-2 overflow-hidden">
          <div className="flex items-center justify-between gap-1 px-1 pt-0.5">
            <Link
              to="/platform/chat"
              aria-label="Monorepo"
              className="inline-flex min-w-0 items-center gap-1.5 font-semibold"
            >
              <BoxesIcon aria-hidden="true" className="size-4 shrink-0" />
              <span className="truncate text-sm">Monorepo</span>
            </Link>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="收起侧栏"
              className="size-7 shrink-0"
              onClick={onToggle}
            >
              <PanelLeftIcon aria-hidden="true" className="size-3.5" />
            </Button>
          </div>

          <div className="flex items-center justify-between gap-1 px-0.5">
            <span className="truncate text-[11px] font-medium text-muted-foreground">
              会话
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={onCreate}
              disabled={creating}
              aria-label="新建会话"
              className="size-7 shrink-0"
            >
              <PlusIcon aria-hidden="true" className="size-3.5" />
            </Button>
          </div>

          <Section className="min-h-0 flex-1 gap-0.5 overflow-y-auto">
            {conversations === null ? (
              <div className="space-y-2 px-1">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-3/4" />
              </div>
            ) : conversations.length === 0 ? (
              <p className="px-2 text-xs text-muted-foreground">
                暂无会话，点击右上「新建」开始对话。
              </p>
            ) : (
              <nav className="grid gap-0.5" aria-label="会话列表">
                {conversations.map((conversation) => {
                  const active = activePath.endsWith(`/${conversation.id}`);
                  return (
                    <div
                      key={conversation.id}
                      className="group flex min-w-0 items-center gap-0.5 rounded-lg hover:bg-muted/50"
                    >
                      <Button
                        asChild
                        variant={active ? "secondary" : "ghost"}
                        className="h-auto min-w-0 flex-1 justify-start gap-1.5 rounded-md px-1.5 py-1.5 text-left shadow-none"
                      >
                        <Link
                          to={`/platform/chat/conversations/${conversation.id}`}
                        >
                          <MessageSquareIcon
                            aria-hidden="true"
                            className="size-3.5 shrink-0 opacity-60"
                          />
                          <span className="truncate text-xs font-normal">
                            {conversation.title}
                          </span>
                        </Link>
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            aria-label={`${conversation.title} 更多操作`}
                            className="size-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
                          >
                            <MoreHorizontalIcon
                              aria-hidden="true"
                              className="size-4 text-muted-foreground"
                            />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40">
                          <DropdownMenuItem
                            onSelect={() => onOpenTrace(conversation.id)}
                          >
                            <RouteIcon
                              aria-hidden="true"
                              className="mr-2 size-4"
                            />
                            执行轨迹
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onSelect={() => onExport(conversation.id)}
                          >
                            <DownloadIcon
                              aria-hidden="true"
                              className="mr-2 size-4"
                            />
                            导出 Markdown
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() => onDelete(conversation.id)}
                          >
                            <Trash2Icon
                              aria-hidden="true"
                              className="mr-2 size-4"
                            />
                            删除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  );
                })}
              </nav>
            )}
          </Section>

          <div className="mt-auto border-t pt-1.5">
            <ChatUserMenu />
          </div>
        </div>
        <ChatPanelResizeHandle
          edge="left-panel"
          value={width}
          minValue={resizeMin}
          maxValue={resizeMax}
          disabled={!open}
          onDrag={onResize}
          onDragStart={onResizeStart}
          onDragEnd={onResizeEnd}
        />
      </Aside>

      {!open && showToggle ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="展开会话列表"
          className="absolute top-2 left-2 z-30 size-8 bg-background/80 shadow-sm backdrop-blur-sm"
          onClick={onToggle}
        >
          <PanelLeftIcon aria-hidden="true" className="size-4" />
        </Button>
      ) : null}
    </>
  );
}
