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
  desktop = false,
  label,
  items,
  onSelect,
  onLoadMore,
  loadMoreLabel = "显示更早的会话",
}: {
  desktop?: boolean;
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
            title={desktop ? item.title : undefined}
            aria-current={item.active ? "page" : undefined}
            onClick={onSelect}
            className={cn(
              buttonVariants({ variant: item.active ? "secondary" : "ghost" }),
              "w-full min-w-0 justify-start gap-2 rounded-lg type-body font-normal",
              desktop
                ? "h-[1.9375rem] border-0 px-2 pr-6 text-sidebar-foreground/80 hover:bg-sidebar-accent focus-visible:bg-sidebar-accent"
                : "h-9 pr-9",
              desktop && item.actions && "group-hover/menu-item:pr-8 group-focus-within/menu-item:pr-8",
            )}
          >
            {item.icon}
            <span
              className={
                desktop
                  ? "min-w-0 overflow-hidden whitespace-nowrap mask-r-from-[calc(100%-0.75rem)] mask-r-to-100% pr-3"
                  : "truncate"
              }
            >
              {item.title}
            </span>
          </Link>
          {item.actions}
        </SidebarMenuItem>
      ))}
      {onLoadMore ? (
        <SidebarMenuItem>
          <Button
            variant="ghost"
            className={
              desktop
                ? "h-[1.9375rem] w-full justify-start border-0 px-2 text-sm font-normal text-muted-foreground"
                : "w-full"
            }
            onClick={onLoadMore}
          >
            {loadMoreLabel}
          </Button>
        </SidebarMenuItem>
      ) : null}
    </SidebarMenu>
  );
}
