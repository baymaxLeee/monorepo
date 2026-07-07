import { logout, switchActiveOrg } from "api";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
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
import {
  ActivityIcon,
  BoxesIcon,
  BrainIcon,
  CheckIcon,
  ChevronsUpDownIcon,
  LogOutIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import {
  clearUser as clearObservabilityUser,
  recordPageView,
  setUser as setObservabilityUser,
} from "observability";
import { useEffect } from "react";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { usePlatformStore } from "runtime";
import { useShallow } from "zustand/react/shallow";
import { activeMemberships, isSuperAdmin, landingPath } from "../../onboarding";
import { resetApps, useAppsStore } from "../../store/apps";

function getUserInitials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "U";
}

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
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
  // Org-scoped shell: an unbound non-super_admin can't use org resources yet;
  // route them to select-org / waiting room instead of an empty shell.
  if (!user.activeOrg && !isSuperAdmin(user)) {
    return <Navigate to={landingPath(user)} replace />;
  }

  const orgs = activeMemberships(user);
  const canSwitchOrg = orgs.length > 1;

  async function handleLogout() {
    await logout();
    setUser(null);
    resetApps();
    clearObservabilityUser();
  }

  async function handleSwitchOrg(orgId: string) {
    if (orgId === user?.activeOrg?.orgId) return;
    try {
      const session = await switchActiveOrg(orgId);
      // Persist the rescoped identity into the store BEFORE reloading — the
      // full reload then rehydrates the new org and drops all in-memory
      // org-scoped state (platform apps + each MFE's query cache).
      setUser(session.user);
      window.location.assign("/platform/home");
    } catch {}
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
          {user.activeOrg &&
            (canSwitchOrg ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="hidden max-w-48 gap-1.5 md:inline-flex"
                    title={`当前团队：${user.activeOrg.orgName}`}
                  >
                    <UsersIcon
                      aria-hidden="true"
                      className="size-3.5 shrink-0"
                    />
                    <span className="truncate">{user.activeOrg.orgName}</span>
                    <ChevronsUpDownIcon
                      aria-hidden="true"
                      className="size-3.5 shrink-0 opacity-60"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>切换团队</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {orgs.map((m) => (
                    <DropdownMenuItem
                      key={m.orgId}
                      onSelect={() => handleSwitchOrg(m.orgId)}
                    >
                      <CheckIcon
                        aria-hidden="true"
                        className={`mr-2 size-4 ${
                          m.orgId === user.activeOrg?.orgId
                            ? "opacity-100"
                            : "opacity-0"
                        }`}
                      />
                      <span className="truncate">{m.orgName}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <Badge
                variant="outline"
                className="hidden max-w-40 gap-1 md:inline-flex"
                title={`当前团队：${user.activeOrg.orgName}`}
              >
                <UsersIcon aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate">{user.activeOrg.orgName}</span>
              </Badge>
            ))}
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
              {user.activeOrg && (
                <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                  团队：{user.activeOrg.orgName}
                </DropdownMenuLabel>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link to="/platform/profile">
                  <UserIcon aria-hidden="true" className="mr-2 size-4" />
                  修改个人资料
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  const inChat = location.pathname.startsWith("/platform/chat");
                  const params = new URLSearchParams(
                    inChat ? location.search : undefined,
                  );
                  params.set("panel", "memory");
                  navigate({
                    pathname: inChat
                      ? location.pathname
                      : "/platform/chat/conversations",
                    search: params.toString(),
                  });
                }}
              >
                <BrainIcon aria-hidden="true" className="mr-2 size-4" />
                记忆
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
