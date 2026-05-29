import { logout } from "api";
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
} from "components";
import { ActivityIcon, BoxesIcon, LogOutIcon, UserIcon } from "lucide-react";
import {
  clearUser as clearObservabilityUser,
  recordPageView,
  setUser as setObservabilityUser,
} from "observability";
import { useEffect } from "react";
import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { usePlatformStore } from "runtime";
import { useShallow } from "zustand/react/shallow";
import { resetApps, useAppsStore } from "../../store/apps";

function getUserInitials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "U";
}

export function Layout() {
  const location = useLocation();
  const { user, setUser } = usePlatformStore(
    useShallow((state) => ({
      user: state.user,
      setUser: state.setUser,
    })),
  );
  const apps = useAppsStore((state) => state.apps);

  useEffect(() => {
    recordPageView();
  }, [location.pathname]);

  useEffect(() => {
    if (user) {
      setObservabilityUser({
        userId: user.id,
        username: user.displayName,
      });
    } else {
      clearObservabilityUser();
    }
  }, [user]);

  if (!user) return <Navigate to="/login" replace />;

  async function handleLogout() {
    await logout();
    setUser(null);
    resetApps();
    clearObservabilityUser();
  }

  return (
    <LayoutFrame className="h-svh overflow-hidden">
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
          {apps.map((m) => (
            <Button
              key={m.id}
              asChild
              variant={
                location.pathname.startsWith(m.base_path)
                  ? "secondary"
                  : "ghost"
              }
              size="sm"
            >
              <Link to={m.base_path}>{m.title}</Link>
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
              <DropdownMenuItem asChild>
                <Link to="/platform/observability">
                  <ActivityIcon aria-hidden="true" className="mr-2 size-4" />
                  我的可观测数据
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

      <Main className="overflow-y-auto">
        <Outlet />
      </Main>
    </LayoutFrame>
  );
}

export default Layout;
