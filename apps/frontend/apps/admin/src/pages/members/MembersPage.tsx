import {
  approveMember,
  listWorkspaceMembers,
  listWorkspacesForAdmin,
  type WorkspaceAdminView,
  type WorkspaceMemberView,
  rejectMember,
  setMemberRole,
} from "@repo/api";
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
} from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { useCallback, useEffect, useState } from "react";

import { useAdminIdentity } from "../../identity";

type StatusFilter = "" | "pending" | "active" | "rejected";

const ROLE_LABEL: Record<WorkspaceMemberView["role"], string> = {
  workspace_admin: "管理员",
  member: "成员",
};

function statusBadge(status: WorkspaceMemberView["status"]) {
  if (status === "active") {
    return <Badge>已通过</Badge>;
  }
  if (status === "pending") {
    return <Badge variant="secondary">待审批</Badge>;
  }
  return <Badge variant="destructive">已拒绝</Badge>;
}

export function MembersPage() {
  const { canViewMembers, canManageMembers, isSuperAdmin, activeWorkspaceId, activeWorkspaceName } = useAdminIdentity();
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceAdminView[]>([]);
  const [pickedWorkspaceId, setPickedWorkspaceId] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [members, setMembers] = useState<WorkspaceMemberView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  // super_admin may inspect any workspace's roster (read-only oversight) via the
  // picker; an workspace_admin is locked to their active workspace.
  const workspaceId = isSuperAdmin ? pickedWorkspaceId : activeWorkspaceId;

  // Write actions (approve/reject/role) are allowed only where the caller is an
  // active workspace_admin — i.e. its own active workspace. A super_admin browsing another
  // workspace gets a read-only view; to manage it, it must be an workspace_admin there.
  const canActOnWorkspace = canManageMembers && workspaceId != null && workspaceId === activeWorkspaceId;

  useEffect(() => {
    if (!isSuperAdmin) {
      return;
    }
    listWorkspacesForAdmin({ skipErrorNotify: true })
      .then((workspaces) => {
        setWorkspaceOptions(workspaces);
        setPickedWorkspaceId((prev) => prev ?? activeWorkspaceId ?? workspaces[0]?.id ?? null);
      })
      .catch(() => {
        /* picker is best-effort */
      });
  }, [isSuperAdmin, activeWorkspaceId]);

  const load = useCallback(() => {
    if (!workspaceId) {
      setMembers(null);
      return;
    }
    setLoading(true);
    setError(null);
    listWorkspaceMembers(workspaceId, status || undefined, { skipErrorNotify: true })
      .then(setMembers)
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false));
  }, [workspaceId, status]);

  useEffect(() => {
    if (canViewMembers) {
      load();
    }
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
          <AlertDescription>成员管理仅对工作空间管理员（workspace_admin）或平台 super_admin 开放。</AlertDescription>
        </Alert>
      </Page>
    );
  }

  async function run(userId: string, fn: () => Promise<void>, ok: string) {
    setBusyUser(userId);
    try {
      await fn();
      toast.add({ type: "success", title: ok });
      load();
    } catch {
    } finally {
      setBusyUser(null);
    }
  }

  function approve(m: WorkspaceMemberView) {
    if (!workspaceId) {
      return;
    }
    void run(m.userId, () => approveMember(workspaceId, m.userId), "已通过申请");
  }

  function reject(m: WorkspaceMemberView) {
    if (!workspaceId) {
      return;
    }
    const reason = window.prompt(`拒绝「${m.displayName || m.account}」的理由（可选）`);
    if (reason === null) {
      return;
    }
    void run(m.userId, () => rejectMember(workspaceId, m.userId, reason), "已拒绝申请");
  }

  function changeRole(m: WorkspaceMemberView, role: WorkspaceMemberView["role"]) {
    if (!workspaceId) {
      return;
    }
    void run(
      m.userId,
      () => setMemberRole(workspaceId, m.userId, role),
      role === "workspace_admin" ? "已设为管理员" : "已设为成员",
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
          <Button variant="outline" onClick={load} disabled={loading || !workspaceId}>
            刷新
          </Button>
        </PageActions>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-3">
        {isSuperAdmin ? (
          <Select value={workspaceId ?? ""} onValueChange={(v) => setPickedWorkspaceId(v)}>
            <SelectTrigger aria-label="要管理的工作空间" className="w-64">
              <SelectValue placeholder="选择要管理的工作空间" />
            </SelectTrigger>
            <SelectContent>
              {workspaceOptions.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Badge variant="outline">团队：{activeWorkspaceName ?? "—"}</Badge>
        )}
        <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
          <SelectTrigger aria-label="成员状态" className="w-40">
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

      {isSuperAdmin && workspaceId && !canActOnWorkspace && (
        <Alert>
          <AlertTitle>只读视图</AlertTitle>
          <AlertDescription>
            作为平台 super_admin，你可以查看任意工作空间的成员名册用于治理（如查取用户
            ID），但审批与角色调整必须由该工作空间的 workspace_admin 执行。如需亲自管理，请先成为该工作空间的管理员。
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
            {!workspaceId
              ? "请选择要管理的工作空间"
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
                      <TableCell className="text-muted-foreground">{m.email || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{ROLE_LABEL[m.role]}</Badge>
                      </TableCell>
                      <TableCell>{statusBadge(m.status)}</TableCell>
                      <TableCell className="space-x-1 text-right">
                        {!canActOnWorkspace ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <>
                            {m.status === "pending" && (
                              <>
                                <Button variant="link" size="sm" disabled={busy} onClick={() => approve(m)}>
                                  通过
                                </Button>
                                <Button variant="link" size="sm" disabled={busy} onClick={() => reject(m)}>
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
                                  onClick={() => changeRole(m, "workspace_admin")}
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
