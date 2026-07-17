import {
  applyToOrg,
  fetchMe,
  fetchPublicOrgs,
  logout,
  type Membership,
  type OrgSummary,
  switchActiveOrg,
} from "api";
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
} from "components";
import { clearUser as clearObservabilityUser } from "observability";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { type PlatformUser, usePlatformStore } from "runtime";
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
  const { user, setUser } = usePlatformStore(
    useShallow((state) => ({ user: state.user, setUser: state.setUser })),
  );
  const [orgs, setOrgs] = useState<OrgSummary[]>([]);
  const [selectedOrg, setSelectedOrg] = useState("");
  const [applying, setApplying] = useState(false);
  const busy = useRef(false);

  // Bind the session to a freshly-approved membership, or route to the picker
  // when several are active. `me` reflects DB truth but the access token stays
  // unscoped until we explicitly switch, so an approval requires switchActiveOrg.
  const applyIdentity = useCallback(
    async (me: PlatformUser) => {
      setUser(me);
      if (me.activeOrg || isSuperAdmin(me)) {
        navigate("/platform/chat", { replace: true });
        return;
      }
      const active = activeMemberships(me);
      if (active.length === 1) {
        const session = await switchActiveOrg(active[0].orgId);
        setUser(session.user);
        window.location.assign("/platform/chat");
      } else if (active.length > 1) {
        navigate("/select-org", { replace: true });
      }
    },
    [navigate, setUser],
  );

  useEffect(() => {
    fetchPublicOrgs({ skipErrorNotify: true })
      .then(setOrgs)
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
        if (alive) await applyIdentity(me);
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

  if (!user) return null;

  const heldOrgIds = new Set(user.memberships.map((m) => m.orgId));
  const joinableOrgs = orgs.filter((o) => !heldOrgIds.has(o.id));
  const pendingMemberships = user.memberships.filter(
    (m) => m.status === "pending",
  );
  const rejectedMemberships = user.memberships.filter(
    (m) => m.status === "rejected",
  );

  async function refresh() {
    try {
      setUser(await fetchMe());
    } catch {
      /* ignore */
    }
  }

  async function handleReapply(orgId: string) {
    try {
      await applyToOrg(orgId);
      toast.success("已重新提交申请");
      await refresh();
    } catch {}
  }

  async function handleApplyOther() {
    if (!selectedOrg) return;
    setApplying(true);
    try {
      await applyToOrg(selectedOrg);
      toast.success("申请已提交");
      setSelectedOrg("");
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
          <CardDescription>
            你的组织加入申请正在等待管理员审批，通过后会自动进入平台。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {pendingMemberships.length > 0 && (
            <ul className="space-y-2">
              {pendingMemberships.map((m) => (
                <li
                  key={m.orgId}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <span className="truncate">{m.orgName}</span>
                  <Badge variant="secondary">{STATUS_LABEL[m.status]}</Badge>
                </li>
              ))}
            </ul>
          )}

          {rejectedMemberships.length > 0 && (
            <ul className="space-y-2">
              {rejectedMemberships.map((m) => (
                <li
                  key={m.orgId}
                  className="space-y-2 rounded-md border border-destructive/40 px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{m.orgName}</span>
                    <Badge variant="destructive">
                      {STATUS_LABEL[m.status]}
                    </Badge>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleReapply(m.orgId)}
                  >
                    重新申请
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {joinableOrgs.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <Muted className="text-xs">申请加入其他组织</Muted>
              <div className="flex items-center gap-2">
                <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择组织" />
                  </SelectTrigger>
                  <SelectContent>
                    {joinableOrgs.map((o) => (
                      <SelectItem key={o.id} value={o.id}>
                        {o.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  onClick={handleApplyOther}
                  disabled={!selectedOrg || applying}
                >
                  申请
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t pt-4">
            <Muted className="text-xs">正在检查审批状态…</Muted>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleLogout}
            >
              退出登录
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export { PendingPage as Component };
