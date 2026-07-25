import { assignUserRole, listPlatformRoles, listUserPlatformRoles, type PlatformRole, removeUserRole } from "api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Input,
  Muted,
  Page,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
  toast,
} from "components";
import { useEffect, useState } from "react";

import { useAdminIdentity } from "../../identity";

const SUPER_ADMIN = "super_admin";

export function PlatformRolesPage() {
  const { isSuperAdmin } = useAdminIdentity();
  const [allRoles, setAllRoles] = useState<PlatformRole[]>([]);
  const [userId, setUserId] = useState("");
  const [queried, setQueried] = useState<string | null>(null);
  const [userRoles, setUserRoles] = useState<PlatformRole[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isSuperAdmin) {
      return;
    }
    listPlatformRoles()
      .then(setAllRoles)
      .catch(() => {
        /* best-effort; needed to resolve the super_admin role id */
      });
  }, [isSuperAdmin]);

  if (!isSuperAdmin) {
    return (
      <Page>
        <PageHeader>
          <PageHeaderContent>
            <PageTitle>平台角色</PageTitle>
            <PageDescription>授予或撤销平台级 super_admin。</PageDescription>
          </PageHeaderContent>
        </PageHeader>
        <Alert>
          <AlertTitle>无权访问</AlertTitle>
          <AlertDescription>平台角色管理仅对 super_admin 开放。</AlertDescription>
        </Alert>
      </Page>
    );
  }

  const superRole = allRoles.find((r) => r.name === SUPER_ADMIN);
  const hasSuper = userRoles?.some((r) => r.name === SUPER_ADMIN) ?? false;

  async function query() {
    const id = userId.trim();
    if (!id) {
      toast.error("请输入用户 ID");
      return;
    }
    setLoading(true);
    try {
      setUserRoles(await listUserPlatformRoles(id));
      setQueried(id);
    } catch {
      setUserRoles(null);
      setQueried(null);
    } finally {
      setLoading(false);
    }
  }

  async function toggleSuper() {
    if (!queried || !superRole) {
      return;
    }
    setBusy(true);
    try {
      if (hasSuper) {
        await removeUserRole(queried, superRole.id);
        toast.success("已撤销 super_admin");
      } else {
        await assignUserRole(queried, superRole.id);
        toast.success("已授予 super_admin");
      }
      setUserRoles(await listUserPlatformRoles(queried));
    } catch {
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>平台角色</PageTitle>
          <PageDescription>按用户 ID 授予或撤销平台级 super_admin（不能撤销最后一个）。</PageDescription>
        </PageHeaderContent>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>查询用户角色</CardTitle>
          <CardDescription>用户 ID 可在「成员管理」列表中获取。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-end gap-3">
            <Field className="flex-1">
              <FieldLabel>用户 ID</FieldLabel>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && query()}
              />
            </Field>
            <Button type="button" onClick={query} disabled={loading}>
              查询
            </Button>
          </div>

          {userRoles && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">当前角色：</span>
                {userRoles.length > 0 ? (
                  userRoles.map((r) => (
                    <Badge key={r.id} variant="outline">
                      {r.name}
                    </Badge>
                  ))
                ) : (
                  <Muted>无平台角色</Muted>
                )}
              </div>
              <Button
                type="button"
                variant={hasSuper ? "destructive" : "default"}
                onClick={toggleSuper}
                disabled={busy || !superRole}
              >
                {hasSuper ? "撤销 super_admin" : "授予 super_admin"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}

export default PlatformRolesPage;
