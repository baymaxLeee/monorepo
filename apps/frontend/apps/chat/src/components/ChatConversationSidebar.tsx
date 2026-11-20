import { useChatStore } from "@repo/ai-elements/conversation/store/useChatStore";
import {
  Button,
  Sidebar,
  SidebarContent,
  SidebarGroupLabel,
  SidebarHeader,
  Skeleton,
  useSidebar,
} from "@repo/design-system";
import { MessageCircleIcon, MessageSquareIcon, PanelLeftCloseIcon, SquarePenIcon } from "lucide-react";
import { memo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { useConversationHistory } from "../hooks/useConversationHistory";
import { ChatConversationActions } from "./ChatConversationActions";
import { ConversationHistoryList } from "./ConversationHistoryList";

const HISTORY_PAGE_SIZE = 40;

export const ChatConversationSidebar = memo(function ChatConversationSidebar() {
  const { isMobile, open, setOpen, setOpenMobile } = useSidebar();
  const history = useConversationHistory();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(HISTORY_PAGE_SIZE);
  const openTrace = useChatStore((s) => s.openTracePanel);
  const closeMobile = () => setOpenMobile(false);
  return (
    <Sidebar
      collapsible={isMobile ? "offcanvas" : "none"}
      className="w-full border-0 bg-sidebar"
      aria-label="会话记录"
      inert={!isMobile && !open}
    >
      <SidebarHeader className="flex-row items-center justify-between px-3 py-3">
        <Link
          to="/platform/chat"
          className="flex min-w-0 items-center gap-2 rounded-lg px-1 py-1 text-base font-semibold"
          onClick={closeMobile}
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-background text-foreground shadow-sm ring-1 ring-border">
            <MessageCircleIcon className="size-4" aria-hidden="true" />
          </span>
          <span className="truncate">Chat</span>
        </Link>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="收起会话记录"
          onClick={() => (isMobile ? closeMobile() : setOpen(false))}
        >
          <PanelLeftCloseIcon />
        </Button>
      </SidebarHeader>
      <Button
        variant="ghost"
        className="mx-2 justify-start gap-2 rounded-lg px-2.5 font-medium"
        onClick={() => {
          void navigate("/platform/chat/conversations");
          closeMobile();
        }}
      >
        <SquarePenIcon />
        新建会话
      </Button>
      <SidebarContent className="px-2 py-4">
        <SidebarGroupLabel className="mt-2 px-2 text-xs font-medium text-muted-foreground">最近</SidebarGroupLabel>
        {history.error ? (
          <div role="alert" className="p-2 text-sm text-muted-foreground">
            {history.error}
            <Button variant="link" onClick={() => void history.load()}>
              重试
            </Button>
          </div>
        ) : history.conversations === null ? (
          <Skeleton className="mx-1 h-24 rounded-lg" />
        ) : history.conversations.length === 0 ? (
          <p className="p-2 text-xs text-muted-foreground">暂无会话</p>
        ) : (
          <ConversationHistoryList
            label="会话列表"
            onSelect={closeMobile}
            items={history.conversations.slice(0, visible).map((item) => ({
              key: item.id,
              href: `/platform/chat/conversations/${item.id}`,
              title: item.title,
              active: history.pathname.endsWith(`/${item.id}`),
              icon: <MessageSquareIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />,
              actions: (
                <ChatConversationActions
                  conversation={item}
                  onDelete={history.remove}
                  onExport={history.download}
                  onOpenTrace={openTrace}
                />
              ),
            }))}
            onLoadMore={
              history.conversations.length > visible
                ? () => setVisible((count) => count + HISTORY_PAGE_SIZE)
                : undefined
            }
          />
        )}
      </SidebarContent>
    </Sidebar>
  );
});
