import { buttonVariants, Tooltip, TooltipContent, TooltipTrigger } from "@repo/design-system";
import { usePlatformStore } from "@repo/runtime";
import { cn } from "@repo/shared";
import { BoxesIcon, BrushIcon, Grid2X2Icon, MessageCircleIcon, SettingsIcon, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import { canAccessApp } from "../../router/access";
import { type App, loadApps } from "../../router/app-registry";
import { PlatformUserMenu } from "./PlatformUserMenu";

const appIcons: Record<string, LucideIcon> = {
  admin: SettingsIcon,
  canvas: BrushIcon,
  chat: MessageCircleIcon,
};

function appSlug(app: App) {
  return app.base_path.replace(/^\/platform\//, "").split("/")[0] ?? app.remote_name;
}

export function PlatformAppRail() {
  const { pathname } = useLocation();
  const user = usePlatformStore((state) => state.user);
  const [apps, setApps] = useState<App[]>([]);

  useEffect(() => {
    let active = true;
    void loadApps()
      .then((registered) => {
        if (active) setApps(registered);
      })
      .catch(() => {
        if (active) setApps([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const accessibleApps = user
    ? apps.filter((app) => canAccessApp(user, app)).sort((left, right) => left.sort_order - right.sort_order)
    : [];

  return (
    <aside aria-label="应用切换" className="flex w-12 shrink-0 flex-col items-center py-1">
      <Link
        to="/platform/chat"
        aria-label="Monorepo 首页"
        className="mb-5 flex size-10 items-center justify-center rounded-xl bg-foreground text-background shadow-sm"
      >
        <BoxesIcon className="size-5" aria-hidden="true" />
      </Link>
      <nav aria-label="应用" className="flex flex-col gap-2">
        {accessibleApps.map((app) => {
          const slug = appSlug(app);
          const Icon = appIcons[slug] ?? Grid2X2Icon;
          const active = pathname === app.base_path || pathname.startsWith(`${app.base_path.replace(/\/+$/, "")}/`);
          return (
            <Tooltip key={app.id}>
              <TooltipTrigger
                render={
                  <Link
                    to={app.base_path}
                    aria-label={app.title}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      buttonVariants({ variant: "ghost", size: "icon" }),
                      "size-10 rounded-xl text-muted-foreground",
                      active && "bg-background text-foreground shadow-sm ring-1 ring-border hover:bg-background",
                    )}
                  />
                }
              >
                <Icon className="size-5" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="right">{app.title}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
      <div className="mt-auto">
        <PlatformUserMenu />
      </div>
    </aside>
  );
}
