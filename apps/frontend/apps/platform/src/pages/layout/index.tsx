import { useEffect } from "react";
import { BoxesIcon, LogOutIcon, UserIcon } from "lucide-react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
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
  Header,
  HeaderSection,
  Layout as LayoutFrame,
  Main,
} from "@packages/components";
import { usePlatformStore } from "@packages/runtime";
import { registry, type MfeEntry } from "../../registry";

function activeMfe(pathname: string): MfeEntry | undefined {
  return registry.find((m) => pathname.startsWith(m.basePath));
}

function getUserInitials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "U";
}

export function Layout() {
  const location = useLocation();
  const user = usePlatformStore((state) => state.user);
  const menus = usePlatformStore((state) => state.menus);
  const setUser = usePlatformStore((state) => state.setUser);
  const setActiveMenuId = usePlatformStore((state) => state.setActiveMenuId);
  const current = activeMfe(location.pathname);
  const platformMenus =
    menus.length > 0
      ? menus
      : registry.map((m) => ({
          id: m.id,
          title: m.title,
          basePath: m.basePath,
        }));

  useEffect(() => {
    setActiveMenuId(current?.id ?? null);
  }, [current?.id, setActiveMenuId]);

  if (!user) return <Navigate to="/login" replace />;

  async function handleLogout() {
    await logout();
    setUser(null);
  }

  return (
    <LayoutFrame>
      <Header>
        <HeaderSection>
          <Link
            aria-label="Monorepo Platform"
            to="/"
            className="inline-flex min-w-0 items-center gap-2 font-semibold"
          >
            <BoxesIcon aria-hidden="true" className="size-5 shrink-0" />
            <span className="truncate">Monorepo</span>
          </Link>
        </HeaderSection>

        <nav
          aria-label="应用"
          className="flex min-w-0 items-center justify-start gap-1"
        >
          {platformMenus.map((m) => (
            <Button
              key={m.id}
              asChild
              variant={
                location.pathname.startsWith(m.basePath) ? "secondary" : "ghost"
              }
              size="sm"
            >
              <Link to={m.basePath}>{m.title}</Link>
            </Button>
          ))}
        </nav>

        <HeaderSection className="justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="max-w-full gap-2 px-2"
                aria-label={user.displayName}
              >
                <Avatar className="size-7">
                  <AvatarImage src={user.avatarUrl} alt={user.displayName} />
                  <AvatarFallback className="text-xs">
                    {getUserInitials(user.displayName)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden max-w-32 truncate text-sm md:inline">
                  {user.displayName}
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel className="truncate">
                {user.displayName}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/platform/profile">
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
        </HeaderSection>
      </Header>

      <Main>
        <Outlet />
      </Main>
    </LayoutFrame>
  );
}

export default Layout;
