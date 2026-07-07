import {
  approveMember,
  listOrgMembers,
  listOrgsForAdmin,
  type OrgAdminView,
  type OrgMemberView,
  rejectMember,
  setMemberRole,
} from "api";
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
  Muted,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "components";
import { useCallback, useEffect, useState } from "react";
import { getErrorMessage } from "shared";
import { useAdminIdentity } from "../identity";

type StatusFilter = "" | "pending" | "active" | "rejected";

const ROLE_LABEL: Record<OrgMemberView["role"], string> = {
  org_admin: "管理员",
  member: "成员",
};

function statusBadge(status: OrgMemberView["status"]) {
  if (status === "active") return <Badge>已通过</Badge>;
  if (status === "pending") return <Badge variant="secondary">待审批</Badge>;
  return <Badge variant="destructive">已拒绝</Badge>;
}

export function MembersPage() {
  const {
    canViewMembers,
    canManageMembers,
    isSuperAdmin,
    activeOrgId,
    activeOrgName,
  } = useAdminIdentity();
  const [orgOptions, setOrgOptions] = useState<OrgAdminView[]>([]);
  const [pickedOrgId, setPickedOrgId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [members, setMembers] = useState<OrgMemberView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  // super_admin may inspect any org's roster (read-only oversight) via the
  // picker; an org_admin is locked to their active org.
  const orgId = isSuperAdmin ? pickedOrgId : activeOrgId;

  // Write actions (approve/reject/role) are allowed only where the caller is an
  // active org_admin — i.e. its own active org. A super_admin browsing another
  // org gets a read-only view; to manage it, it must be an org_admin there.
  const canActOnOrg =
    canManageMembers && orgId != null && orgId === activeOrgId;

  useEffect(() => {
    if (!isSuperAdmin) return;
    listOrgsForAdmin({ skipErrorNotify: true })
      .then((orgs) => {
        setOrgOptions(orgs);
        setPickedOrgId((prev) => prev ?? activeOrgId ?? orgs[0]?.id ?? null);
      })
      .catch(() => {
        /* picker is best-effort */
      });
  }, [isSuperAdmin, activeOrgId]);

  const load = useCallback(() => {
    if (!orgId) {
      setMembers(null);
      return;
    }
    setLoading(true);
    setError(null);
    listOrgMembers(orgId, status || undefined, { skipErrorNotify: true })
      .then(setMembers)
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false));
  }, [orgId, status]);

  useEffect(() => {
    if (canViewMembers) load();
  }, [canViewMembers, load]);

  if (!canViewMembers) {
    return (
      <Page>
        <PageHeader>
          <PageHeaderContent>
            <PageTitle>成员管理</PageTitle>
            <PageDescription>审批加入申请、调整成员角色。</PageDescription>
          </PageHeaderContent>
        </PageHeader>
        <Alert>
          <AlertTitle>无权访问</AlertTitle>
          <AlertDescription>
            成员管理仅对组织管理员（org_admin）或平台 super_admin 开放。
          </AlertDescription>
        </Alert>
      </Page>
    );
  }

  async function run(userId: string, fn: () => Promise<void>, ok: string) {
    setBusyUser(userId);
    try {
      await fn();
      toast.success(ok);
      load();
    } catch {
    } finally {
      setBusyUser(null);
    }
  }

  function approve(m: OrgMemberView) {
    if (!orgId) return;
    void run(m.userId, () => approveMember(orgId, m.userId), "已通过申请");
  }

  function reject(m: OrgMemberView) {
    if (!orgId) return;
    const reason = window.prompt(
      `拒绝「${m.displayName || m.account}」的理由（可选）`,
    );
    if (reason === null) return;
    void run(
      m.userId,
      () => rejectMember(orgId, m.userId, reason),
      "已拒绝申请",
    );
  }

  function changeRole(m: OrgMemberView, role: OrgMemberView["role"]) {
    if (!orgId) return;
    void run(
      m.userId,
      () => setMemberRole(orgId, m.userId, role),
      role === "org_admin" ? "已设为管理员" : "已设为成员",
    );
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>成员管理</PageTitle>
          <PageDescription>审批加入申请、调整成员角色。</PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading || !orgId}>
            刷新
          </Button>
        </PageActions>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        {isSuperAdmin ? (
          <Select value={orgId ?? ""} onValueChange={(v) => setPickedOrgId(v)}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="选择要管理的组织" />
            </SelectTrigger>
            <SelectContent>
              {orgOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline">团队：{activeOrgName ?? "—"}</Badge>
        )}
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as StatusFilter)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">待审批</SelectItem>
            <SelectItem value="active">已通过</SelectItem>
            <SelectItem value="rejected">已拒绝</SelectItem>
            <SelectItem value="">全部</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isSuperAdmin && orgId && !canActOnOrg && (
        <Alert>
          <AlertTitle>只读视图</AlertTitle>
          <AlertDescription>
            作为平台
            super_admin，你可以查看任意组织的成员名册用于治理（如查取用户
            ID），但审批与角色调整必须由该组织的 org_admin
            执行。如需亲自管理，请先成为该组织的管理员。
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>请求失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>成员列表</CardTitle>
          <CardDescription>
            {!orgId
              ? "请选择要管理的组织"
              : loading
                ? "加载中…"
                : members
                  ? `共 ${members.length} 人`
                  : "暂无数据"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : members && members.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>账号</TableHead>
                  <TableHead>昵称</TableHead>
                  <TableHead>邮箱</TableHead>
                  <TableHead>角色</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {members.map((m) => {
                  const busy = busyUser === m.userId;
                  return (
                    <TableRow key={m.userId}>
                      <TableCell className="font-medium">{m.account}</TableCell>
                      <TableCell>{m.displayName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.email || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{ROLE_LABEL[m.role]}</Badge>
                      </TableCell>
                      <TableCell>{statusBadge(m.status)}</TableCell>
                      <TableCell className="space-x-1 text-right">
                        {!canActOnOrg ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            {m.status === "pending" && (
                              <>
                                <Button
                                  variant="link"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => approve(m)}
                                >
                                  通过
                                </Button>
                                <Button
                                  variant="link"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => reject(m)}
                                >
                                  拒绝
                                </Button>
                              </>
                            )}
                            {m.status === "active" &&
                              (m.role === "member" ? (
                                <Button
                                  variant="link"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => changeRole(m, "org_admin")}
                                >
                                  设为管理员
                                </Button>
                              ) : (
                                <Button
                                  variant="link"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => changeRole(m, "member")}
                                >
                                  设为成员
                                </Button>
                              ))}
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <Muted>没有符合条件的成员。</Muted>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}

export default MembersPage;
