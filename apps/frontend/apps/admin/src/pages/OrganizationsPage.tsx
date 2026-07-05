import { listOrgsForAdmin, type OrgAdminView } from "api";
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
} from "components";
import { useCallback, useEffect, useState } from "react";
import { useAdminIdentity } from "../identity";
import { CreateOrganizationDialog } from "./CreateOrganizationDialog";
import {
  CreateOrgAdminDialog,
  TransferOwnerDialog,
} from "./OrganizationMemberDialogs";

export function OrganizationsPage() {
  const { isSuperAdmin } = useAdminIdentity();
  const [orgs, setOrgs] = useState<OrgAdminView[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [adminFor, setAdminFor] = useState<OrgAdminView | null>(null);
  const [transferFor, setTransferFor] = useState<OrgAdminView | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    listOrgsForAdmin()
      .then(setOrgs)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isSuperAdmin) load();
  }, [isSuperAdmin, load]);

  if (!isSuperAdmin) {
    return (
      <Page>
        <PageHeader>
          <PageHeaderContent>
            <PageTitle>组织管理</PageTitle>
            <PageDescription>
              创建组织、指派负责人与组织管理员。
            </PageDescription>
          </PageHeaderContent>
        </PageHeader>
        <Alert>
          <AlertTitle>无权访问</AlertTitle>
          <AlertDescription>
            组织管理仅对平台 super_admin 开放。
          </AlertDescription>
        </Alert>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>组织管理</PageTitle>
          <PageDescription>创建组织、指派负责人与组织管理员。</PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
          <Button onClick={() => setCreateOpen(true)}>新建组织</Button>
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
          <CardTitle>全部组织</CardTitle>
          <CardDescription>
            {loading
              ? "加载中…"
              : orgs
                ? `共 ${orgs.length} 个组织`
                : "暂无数据"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : orgs && orgs.length > 0 ? (
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
                {orgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell className="font-medium">
                      {org.name}
                      {org.systemManaged ? "（系统）" : ""}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {org.slug}
                    </TableCell>
                    <TableCell>{org.memberCount}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {org.ownerUserId}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(org.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setAdminFor(org)}
                      >
                        新建管理员
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setTransferFor(org)}
                        disabled={org.systemManaged}
                      >
                        转让负责人
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Muted>暂无组织，点击「新建组织」创建第一个。</Muted>
          )}
        </CardContent>
      </Card>

      <CreateOrganizationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onDone={load}
      />
      <CreateOrgAdminDialog
        org={adminFor}
        onClose={() => setAdminFor(null)}
        onDone={load}
      />
      <TransferOwnerDialog
        org={transferFor}
        onClose={() => setTransferFor(null)}
        onDone={load}
      />
    </Page>
  );
}

export default OrganizationsPage;
