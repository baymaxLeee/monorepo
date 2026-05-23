import { useEffect, type CSSProperties, type ReactNode } from "react";
import {
  BotIcon,
  BoxesIcon,
  ComponentIcon,
  ListIcon,
  LogOutIcon,
  UserIcon,
  type LucideIcon,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { logout } from "@packages/api";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@packages/components";
import { usePlatformStore, type PlatformUser } from "@packages/runtime";
import { HOME_PATH, PROFILE_PATH, registry, type MfeEntry } from "../registry";

function activeMfe(pathname: string): MfeEntry | undefined {
  return registry.find((m) => pathname.startsWith(m.basePath));
}

const appMenuIcons: Record<string, LucideIcon> = {
  admin: BotIcon,
};

const subMenuIcons: Record<string, LucideIcon> = {
  "/platform/admin": ListIcon,
  "/platform/admin/demo": ComponentIcon,
};

function AppIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden="true" className="size-4" />;
}

function getUserInitials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "U";
}

export function Layout({
  children,
  user,
  onUserChanged,
}: {
  children: ReactNode;
  user: PlatformUser;
  onUserChanged: (user: PlatformUser | null) => void;
}) {
  const location = useLocation();
  const menus = usePlatformStore((state) => state.menus);
  const setActiveMenuId = usePlatformStore((state) => state.setActiveMenuId);
  const current = activeMfe(location.pathname);
  const platformMenus =
    menus.length > 0
      ? menus
      : registry.map((m) => ({
          id: m.id,
          title: m.title,
          basePath: m.basePath,
          subNav: m.subNav,
        }));

  useEffect(() => {
    setActiveMenuId(current?.id ?? null);
  }, [current?.id, setActiveMenuId]);

  async function handleLogout() {
    await logout();
    onUserChanged(null);
  }

  return (
    <SidebarProvider
      open={false}
      style={
        {
          "--sidebar-width-icon": "4.25rem",
        } as CSSProperties
      }
    >
      <Sidebar collapsible="icon">
        <SidebarHeader className="items-center">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                size="lg"
                asChild
                tooltip="Monorepo Platform"
                className="justify-center px-0"
              >
                <Link aria-label="Monorepo Platform" to={HOME_PATH}>
                  <BoxesIcon aria-hidden="true" className="size-5" />
                  <span className="sr-only">Monorepo Platform</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="sr-only">应用</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {platformMenus.map((m) => {
                  const Icon = appMenuIcons[m.id] ?? BoxesIcon;

                  return (
                    <SidebarMenuItem key={m.id}>
                      <SidebarMenuButton
                        asChild
                        isActive={location.pathname.startsWith(m.basePath)}
                        tooltip={m.title}
                        className="justify-center"
                      >
                        <Link aria-label={m.title} to={m.basePath}>
                          <AppIcon icon={Icon} />
                          <span className="sr-only">{m.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {current?.subNav && current.subNav.length > 0 ? (
            <>
              <SidebarSeparator />
              <SidebarGroup>
                <SidebarGroupLabel className="sr-only">
                  {current.title}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {current.subNav.map((item) => {
                      const Icon = subMenuIcons[item.href] ?? ListIcon;

                      return (
                        <SidebarMenuItem key={item.href}>
                          <SidebarMenuButton
                            asChild
                            isActive={location.pathname === item.href}
                            tooltip={item.title}
                            className="justify-center"
                          >
                            <Link aria-label={item.title} to={item.href}>
                              <AppIcon icon={Icon} />
                              <span className="sr-only">{item.title}</span>
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          ) : null}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={user.displayName}
                        className="size-8 rounded-md text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                      >
                        <Avatar className="size-7">
                          <AvatarImage
                            src={user.avatarUrl}
                            alt={user.displayName}
                          />
                          <AvatarFallback className="text-xs">
                            {getUserInitials(user.displayName)}
                          </AvatarFallback>
                        </Avatar>
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="right" align="center">
                    {user.displayName}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent side="right" align="end" className="w-48">
                  <DropdownMenuLabel className="truncate">
                    {user.displayName}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to={PROFILE_PATH}>
                      <UserIcon aria-hidden="true" className="mr-2 size-4" />
                      修改个人资料
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleLogout}>
                    <LogOutIcon aria-hidden="true" className="mr-2 size-4" />
                    退出
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <div className="flex flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
