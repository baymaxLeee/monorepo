import {
  applyToWorkspace,
  fetchMe,
  fetchPublicWorkspaces,
  logout,
  type Membership,
  type WorkspaceSummary,
  switchActiveWorkspace,
} from "@repo/api";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Muted,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@repo/design-system";
import { clearUser as clearObservabilityUser } from "@repo/observability";
import { type PlatformUser, usePlatformStore } from "@repo/runtime";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";

import { activeMemberships, isSuperAdmin } from "../../onboarding";

const POLL_INTERVAL_MS = 5000;

const STATUS_LABEL: Record<Membership["status"], string> = {
  pending: "等待管理员审批",
  active: "已通过",
  rejected: "已被拒绝",
};

function PendingPage() {
  const navigate = useNavigate();
  const { user, setUser } = usePlatformStore(useShallow((state) => ({ user: state.user, setUser: state.setUser })));
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState("");
  const [applying, setApplying] = useState(false);
  const busy = useRef(false);

  // Bind the session to a freshly-approved membership, or route to the picker
  // when several are active. `me` reflects DB truth but the access token stays
  // unscoped until we explicitly switch, so an approval requires switchActiveWorkspace.
  const applyIdentity = useCallback(
    async (me: PlatformUser) => {
      setUser(me);
      if (me.activeWorkspace || isSuperAdmin(me)) {
        navigate("/platform/chat", { replace: true });
        return;
      }
      const active = activeMemberships(me);
      if (active.length === 1) {
        const session = await switchActiveWorkspace(active[0].workspaceId);
        setUser(session.user);
        window.location.assign("/platform/chat");
      } else if (active.length > 1) {
        navigate("/select-workspace", { replace: true });
      }
    },
    [navigate, setUser],
  );

  useEffect(() => {
    fetchPublicWorkspaces({ skipErrorNotify: true })
      .then(setWorkspaces)
      .catch(() => {
        /* directory is best-effort on this screen */
      });
  }, []);

  // Poll for an approval landing while the tab is visible.
  useEffect(() => {
    let alive = true;
    async function poll() {
      if (!alive || busy.current || document.visibilityState !== "visible") {
        return;
      }
      busy.current = true;
      try {
        const me = await fetchMe();
        if (alive) {
          await applyIdentity(me);
        }
      } catch {
        /* transient; retry on next tick */
      } finally {
        busy.current = false;
      }
    }
    void poll();
    const timer = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [applyIdentity]);

  if (!user) {
    return null;
  }

  const heldWorkspaceIds = new Set(user.memberships.map((m) => m.workspaceId));
  const joinableWorkspaces = workspaces.filter((o) => !heldWorkspaceIds.has(o.id));
  const pendingMemberships = user.memberships.filter((m) => m.status === "pending");
  const rejectedMemberships = user.memberships.filter((m) => m.status === "rejected");

  async function refresh() {
    try {
      setUser(await fetchMe());
    } catch {
      /* ignore */
    }
  }

  async function handleReapply(workspaceId: string) {
    try {
      await applyToWorkspace(workspaceId);
      toast.add({ type: "success", title: "已重新提交申请" });
      await refresh();
    } catch {}
  }

  async function handleApplyOther() {
    if (!selectedWorkspace) {
      return;
    }
    setApplying(true);
    try {
      await applyToWorkspace(selectedWorkspace);
      toast.add({ type: "success", title: "申请已提交" });
      setSelectedWorkspace("");
      await refresh();
    } catch {
    } finally {
      setApplying(false);
    }
  }

  async function handleLogout() {
    await logout();
    setUser(null);
    clearObservabilityUser();
    navigate("/login", { replace: true });
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>等待审批</CardTitle>
          <CardDescription>你的工作空间加入申请正在等待管理员审批，通过后会自动进入平台。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pendingMemberships.length > 0 && (
            <ul className="space-y-2">
              {pendingMemberships.map((m) => (
                <li
                  key={m.workspaceId}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="truncate">{m.workspaceName}</span>
                  <Badge variant="secondary">{STATUS_LABEL[m.status]}</Badge>
                </li>
              ))}
            </ul>
          )}

          {rejectedMemberships.length > 0 && (
            <ul className="space-y-2">
              {rejectedMemberships.map((m) => (
                <li key={m.workspaceId} className="space-y-2 rounded-md border border-destructive/40 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{m.workspaceName}</span>
                    <Badge variant="destructive">{STATUS_LABEL[m.status]}</Badge>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => handleReapply(m.workspaceId)}>
                    重新申请
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {joinableWorkspaces.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <Muted className="text-xs">申请加入其他工作空间</Muted>
              <div className="flex items-center gap-2">
                <Select
                  value={selectedWorkspace}
                  onValueChange={(value) => value !== null && setSelectedWorkspace(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择工作空间" />
                  </SelectTrigger>
                  <SelectContent>
                    {joinableWorkspaces.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" onClick={handleApplyOther} disabled={!selectedWorkspace || applying}>
                  申请
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-4">
            <Muted className="text-xs">正在检查审批状态…</Muted>
            <Button type="button" variant="ghost" size="sm" onClick={handleLogout}>
              退出登录
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export { PendingPage as Component };
