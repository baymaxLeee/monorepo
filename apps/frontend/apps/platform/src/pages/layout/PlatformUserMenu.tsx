import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/design-system";
import { clearUser as clearObservabilityUser } from "@repo/observability";
import { getPlatformAuth, type PlatformMembership, usePlatformStore } from "@repo/runtime";
import { BrainIcon, CheckIcon, LogOutIcon, UserIcon } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

function getUserInitials(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || "U";
}

function activeMemberships(memberships: PlatformMembership[] | undefined): PlatformMembership[] {
  return Array.isArray(memberships) ? memberships.filter((membership) => membership.status === "active") : [];
}

export function PlatformUserMenu() {
  const navigate = useNavigate();
  const { user, setUser } = usePlatformStore(useShallow((state) => ({ user: state.user, setUser: state.setUser })));
  if (!user) return null;

  const workspaces = activeMemberships(user.memberships);

  async function handleLogout() {
    await getPlatformAuth()!.logout();
    setUser(null);
    clearObservabilityUser();
  }

  async function handleSwitchWorkspace(workspaceId: string) {
    if (workspaceId === user?.activeWorkspace?.workspaceId) return;
    try {
      await getPlatformAuth()!.switchWorkspace(workspaceId);
      window.location.assign("/platform/chat");
    } catch {}
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 rounded-xl"
            aria-label={`账号：${user.displayName}`}
          />
        }
      >
        <Avatar className="size-8">
          <AvatarImage src={user.avatarUrl} alt={user.displayName} />
          <AvatarFallback className="text-xs">{getUserInitials(user.displayName)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="end" sideOffset={8} className="w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate">{user.displayName}</span>
            {user.activeWorkspace ? (
              <span className="truncate font-normal text-muted-foreground">
                团队：{user.activeWorkspace.workspaceName}
              </span>
            ) : null}
          </DropdownMenuLabel>
          <DropdownMenuItem onClick={() => void navigate("/platform/admin/profile")}>
            <UserIcon aria-hidden="true" />
            个人资料
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void navigate("/platform/chat?panel=memory")}>
            <BrainIcon aria-hidden="true" />
            记忆
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {workspaces.length > 1 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">切换团队</DropdownMenuLabel>
              {workspaces.map((membership) => (
                <DropdownMenuItem
                  key={membership.workspaceId}
                  onClick={() => void handleSwitchWorkspace(membership.workspaceId)}
                >
                  <CheckIcon
                    aria-hidden="true"
                    className={
                      membership.workspaceId === user.activeWorkspace?.workspaceId ? "opacity-100" : "opacity-0"
                    }
                  />
                  <span className="truncate">{membership.workspaceName}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void handleLogout()}>
          <LogOutIcon aria-hidden="true" />
          退出
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
