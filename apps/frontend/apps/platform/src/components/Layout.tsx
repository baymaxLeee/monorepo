import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { logout } from "@packages/api";
import {
  Button,
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
} from "@packages/components";
import { usePlatformStore, type PlatformUser } from "@packages/runtime";
import { defaultAppPath, registry, type MfeEntry } from "../registry";

function activeMfe(pathname: string): MfeEntry | undefined {
  return registry.find((m) => pathname.startsWith(m.basePath));
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
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <Link to={defaultAppPath}>
                  <span className="truncate font-semibold">Monorepo Demo</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>应用</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {platformMenus.map((m) => (
                  <SidebarMenuItem key={m.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={location.pathname.startsWith(m.basePath)}
                    >
                      <Link to={m.basePath}>
                        <span>{m.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          {current?.subNav && current.subNav.length > 0 ? (
            <>
              <SidebarSeparator />
              <SidebarGroup>
                <SidebarGroupLabel>{current.title}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {current.subNav.map((item) => (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={location.pathname === item.href}
                        >
                          <Link to={item.href}>
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            </>
          ) : null}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <div className="flex w-full items-center justify-between gap-2 px-2 py-1.5">
                <span className="truncate text-sm text-muted-foreground">
                  {user.displayName}
                </span>
                <Button variant="outline" size="sm" onClick={handleLogout}>
                  退出
                </Button>
              </div>
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
