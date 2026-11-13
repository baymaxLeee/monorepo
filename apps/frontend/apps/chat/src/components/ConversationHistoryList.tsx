import { Button, SidebarMenu, SidebarMenuItem, buttonVariants } from "@repo/design-system";
import { cn } from "@repo/shared";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface ConversationHistoryItem {
  key: string;
  href: string;
  title: string;
  active: boolean;
  icon: ReactNode;
  actions?: ReactNode;
}

export function ConversationHistoryList({
  label,
  items,
  onSelect,
  onLoadMore,
  loadMoreLabel = "显示更早的会话",
}: {
  label: string;
  items: readonly ConversationHistoryItem[];
  onSelect: () => void;
  onLoadMore?: () => void;
  loadMoreLabel?: string;
}) {
  return (
    <SidebarMenu aria-label={label}>
      {items.map((item) => (
        <SidebarMenuItem key={item.key}>
          <Link
            to={item.href}
            aria-current={item.active ? "page" : undefined}
            onClick={onSelect}
            className={cn(
              buttonVariants({ variant: item.active ? "secondary" : "ghost" }),
              "h-9 w-full min-w-0 justify-start gap-2 pr-9 text-sm font-normal",
            )}
          >
            {item.icon}
            <span className="truncate">{item.title}</span>
          </Link>
          {item.actions}
        </SidebarMenuItem>
      ))}
      {onLoadMore ? (
        <SidebarMenuItem>
          <Button variant="ghost" className="w-full" onClick={onLoadMore}>
            {loadMoreLabel}
          </Button>
        </SidebarMenuItem>
      ) : null}
    </SidebarMenu>
  );
}
