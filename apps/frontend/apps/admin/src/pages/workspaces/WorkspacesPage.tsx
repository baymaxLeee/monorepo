import { listWorkspacesForAdmin, type WorkspaceAdminView } from "@repo/api";
import {
  Alert,
  AlertDescription,
  AlertTitle,
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { useCallback, useEffect, useState } from "react";

import { useAdminIdentity } from "../../identity";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { CreateWorkspaceAdminDialog, TransferOwnerDialog } from "./WorkspaceMemberDialogs";

export function WorkspacesPage() {
  const { isSuperAdmin } = useAdminIdentity();
  const [workspaces, setWorkspaces] = useState<WorkspaceAdminView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [adminFor, setAdminFor] = useState<WorkspaceAdminView | null>(null);
  const [transferFor, setTransferFor] = useState<WorkspaceAdminView | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listWorkspacesForAdmin({ skipErrorNotify: true })
      .then(setWorkspaces)
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isSuperAdmin) {
      load();
    }
  }, [isSuperAdmin, load]);

  if (!isSuperAdmin) {
    return (
      <Page>
        <PageHeader>
          <PageHeaderContent>
            <PageTitle>工作空间管理</PageTitle>
            <PageDescription>创建工作空间、指派负责人与工作空间管理员。</PageDescription>
          </PageHeaderContent>
        </PageHeader>
        <Alert>
          <AlertTitle>无权访问</AlertTitle>
          <AlertDescription>工作空间管理仅对平台 super_admin 开放。</AlertDescription>
        </Alert>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>工作空间管理</PageTitle>
          <PageDescription>创建工作空间、指派负责人与工作空间管理员。</PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
          <Button onClick={() => setCreateOpen(true)}>新建工作空间</Button>
        </PageActions>
      </PageHeader>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>请求失败</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>全部工作空间</CardTitle>
          <CardDescription>
            {loading ? "加载中…" : workspaces ? `共 ${workspaces.length} 个工作空间` : "暂无数据"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : workspaces && workspaces.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>成员数</TableHead>
                  <TableHead>负责人 ID</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspaces.map((workspace) => (
                  <TableRow key={workspace.id}>
                    <TableCell className="font-medium">
                      {workspace.name}
                      {workspace.systemManaged ? "（系统）" : ""}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{workspace.slug}</TableCell>
                    <TableCell>{workspace.memberCount}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{workspace.ownerUserId}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(workspace.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button variant="link" size="sm" onClick={() => setAdminFor(workspace)}>
                        新建管理员
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setTransferFor(workspace)}
                        disabled={workspace.systemManaged}
                      >
                        转让负责人
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Muted>暂无工作空间，点击「新建工作空间」创建第一个。</Muted>
          )}
        </CardContent>
      </Card>

      <CreateWorkspaceDialog open={createOpen} onOpenChange={setCreateOpen} onDone={load} />
      <CreateWorkspaceAdminDialog workspace={adminFor} onClose={() => setAdminFor(null)} onDone={load} />
      <TransferOwnerDialog workspace={transferFor} onClose={() => setTransferFor(null)} onDone={load} />
    </Page>
  );
}

export default WorkspacesPage;
