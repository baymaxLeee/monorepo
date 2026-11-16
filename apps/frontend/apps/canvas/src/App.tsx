import { buttonVariants, Toaster, TooltipProvider } from "@repo/design-system";
import { cn } from "@repo/shared";
import { ClapperboardIcon, FolderKanbanIcon, LibraryBigIcon } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { ConfirmDialogHost } from "./components/common";

function CanvasMenu() {
  const { pathname } = useLocation();
  const projectId = pathname.match(/\/projects\/([^/]+)/)?.[1];
  const items = [
    {
      title: "项目",
      href: "/platform/canvas/projects",
      icon: FolderKanbanIcon,
      active: pathname === "/platform/canvas/projects",
    },
    ...(projectId
      ? [
          {
            title: "视频创作",
            href: `/platform/canvas/projects/${projectId}/canvases`,
            icon: ClapperboardIcon,
            active: pathname.includes("/canvases") || pathname.includes("/studio/"),
          },
          {
            title: "资产库",
            href: `/platform/canvas/projects/${projectId}/resources`,
            icon: LibraryBigIcon,
            active: pathname.includes("/resources"),
          },
        ]
      : []),
  ];
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r bg-sidebar p-2" aria-label="Canvas 菜单">
      <h1 className="px-2 py-2 text-base font-semibold">Canvas</h1>
      <nav className="grid gap-1" aria-label="Canvas 导航">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                buttonVariants({ variant: item.active ? "secondary" : "ghost", size: "sm" }),
                "justify-start gap-2",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {item.title}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

export function App() {
  return (
    <TooltipProvider>
      <div className="canvas-web flex h-full min-h-0">
        <CanvasMenu />
        <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <Outlet />
          <ConfirmDialogHost />
        </main>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
