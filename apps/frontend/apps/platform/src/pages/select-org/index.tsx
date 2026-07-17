import { logout, switchActiveOrg } from "api";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "components";
import { UsersIcon } from "lucide-react";
import { clearUser as clearObservabilityUser } from "observability";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePlatformStore } from "runtime";
import { useShallow } from "zustand/react/shallow";
import { activeMemberships } from "../../onboarding";

function SelectOrgPage() {
  const navigate = useNavigate();
  const { user, setUser } = usePlatformStore(
    useShallow((state) => ({ user: state.user, setUser: state.setUser })),
  );
  const [switching, setSwitching] = useState<string | null>(null);

  if (!user) return null;
  const orgs = activeMemberships(user);

  async function handlePick(orgId: string) {
    setSwitching(orgId);
    try {
      const session = await switchActiveOrg(orgId);
      // Persist the rescoped identity before the reload so the shell boots
      // cleanly bound to the chosen org.
      setUser(session.user);
      window.location.assign("/platform/chat");
    } catch {
      setSwitching(null);
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
          <CardTitle>选择团队</CardTitle>
          <CardDescription>
            你属于多个团队，请选择要进入的团队。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-2">
            {orgs.map((m) => (
              <li key={m.orgId}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-start gap-3 px-3 py-3"
                  disabled={switching !== null}
                  onClick={() => handlePick(m.orgId)}
                >
                  <UsersIcon aria-hidden="true" className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    {m.orgName}
                  </span>
                  {m.role === "org_admin" && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      管理员
                    </span>
                  )}
                  {switching === m.orgId && (
                    <span className="shrink-0 text-xs text-muted-foreground">
                      进入中…
                    </span>
                  )}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-end border-t pt-3">
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

export { SelectOrgPage as Component };
