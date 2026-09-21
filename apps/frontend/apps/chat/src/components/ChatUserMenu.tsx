import { logout, switchActiveWorkspace } from "@repo/api";
import { useChatStore } from "@repo/chat/store/useChatStore";
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
} from "@repo/design-system";
import { clearUser as clearObservabilityUser } from "@repo/observability";
import { type PlatformMembership, usePlatformStore } from "@repo/runtime";
import { BrainIcon, CheckIcon, ChevronsUpDownIcon, LogOutIcon, SettingsIcon, UserIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

function getUserInitials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "U";
}

function activeMemberships(memberships: PlatformMembership[] | undefined): PlatformMembership[] {
  return Array.isArray(memberships) ? memberships.filter((m) => m.status === "active") : [];
}

export function ChatUserMenu() {
  const navigate = useNavigate();
  const { user, setUser } = usePlatformStore(useShallow((state) => ({ user: state.user, setUser: state.setUser })));
  const setMemoryPanelOpen = useChatStore((s) => s.setMemoryPanelOpen);

  if (!user) {
    return null;
  }

  const workspaces = activeMemberships(user.memberships);
  const canSwitchWorkspace = workspaces.length > 1;

  async function handleLogout() {
    await logout();
    setUser(null);
    clearObservabilityUser();
  }

  async function handleSwitchWorkspace(workspaceId: string) {
    if (workspaceId === user?.activeWorkspace?.workspaceId) {
      return;
    }
    try {
      const session = await switchActiveWorkspace(workspaceId);
      // Persist the rescoped identity before the reload so the shell rehydrates
      // bound to the new workspace and drops all in-memory workspace-scoped state.
      setUser(session.user);
      window.location.assign("/platform/chat");
    } catch {}
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start gap-2 px-1.5 py-1.5"
          aria-label={user.displayName}
        >
          <Avatar className="size-7 shrink-0">
            <AvatarImage src={user.avatarUrl} alt={user.displayName} />
            <AvatarFallback className="text-xs">{getUserInitials(user.displayName)}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-1 flex-col text-left">
            <span className="truncate text-xs font-medium">{user.displayName}</span>
            {user.activeWorkspace && (
              <span className="truncate text-[11px] text-muted-foreground">{user.activeWorkspace.workspaceName}</span>
            )}
          </span>
          <ChevronsUpDownIcon aria-hidden="true" className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuLabel className="truncate">{user.displayName}</DropdownMenuLabel>
        {user.activeWorkspace && (
          <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
            团队：{user.activeWorkspace.workspaceName}
          </DropdownMenuLabel>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate("/platform/admin/profile")}>
          <UserIcon aria-hidden="true" className="mr-2 size-4" />
          个人资料
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/platform/admin/dashboard")}>
          <SettingsIcon aria-hidden="true" className="mr-2 size-4" />
          设置
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setMemoryPanelOpen(true)}>
          <BrainIcon aria-hidden="true" className="mr-2 size-4" />
          记忆
        </DropdownMenuItem>
        {canSwitchWorkspace && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">切换团队</DropdownMenuLabel>
            {workspaces.map((m) => (
              <DropdownMenuItem key={m.workspaceId} onSelect={() => handleSwitchWorkspace(m.workspaceId)}>
                <CheckIcon
                  aria-hidden="true"
                  className={`mr-2 size-4 ${m.workspaceId === user.activeWorkspace?.workspaceId ? "opacity-100" : "opacity-0"}`}
                />
                <span className="truncate">{m.workspaceName}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleLogout}>
          <LogOutIcon aria-hidden="true" className="mr-2 size-4" />
          退出
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
