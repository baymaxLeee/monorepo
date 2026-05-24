import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Page,
  PageActions,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@packages/components";

const scenes = [
  {
    id: "onboarding",
    name: "新用户引导",
    owner: "增长团队",
    status: "启用",
    updatedAt: "2026-05-20 10:24",
  },
  {
    id: "support",
    name: "售后支持",
    owner: "客服团队",
    status: "草稿",
    updatedAt: "2026-05-18 17:42",
  },
  {
    id: "retention",
    name: "用户召回",
    owner: "运营团队",
    status: "启用",
    updatedAt: "2026-05-16 09:11",
  },
];

export function ScenesPage() {
  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>场景管理</PageTitle>
          <PageDescription>
            配置业务场景、责任团队和启停状态，后续接入 admin 服务 CRUD API。
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button>新建场景</Button>
        </PageActions>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>全部场景</CardTitle>
          <CardDescription>演示数据，等待后端模型稳定后接入。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>负责人</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenes.map((scene) => (
                <TableRow key={scene.id}>
                  <TableCell className="font-medium">{scene.name}</TableCell>
                  <TableCell>{scene.owner}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        scene.status === "启用" ? "default" : "secondary"
                      }
                    >
                      {scene.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {scene.updatedAt}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Page>
  );
}
