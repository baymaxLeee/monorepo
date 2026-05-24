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

const intentions = [
  {
    id: "query-order",
    name: "查询订单",
    scene: "售后支持",
    examples: 24,
    status: "启用",
  },
  {
    id: "change-plan",
    name: "变更套餐",
    scene: "新用户引导",
    examples: 18,
    status: "草稿",
  },
  {
    id: "coupon-claim",
    name: "领取优惠",
    scene: "用户召回",
    examples: 31,
    status: "启用",
  },
];

export function IntentionsPage() {
  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>意图管理</PageTitle>
          <PageDescription>
            管理意图名称、归属场景和训练样例数量，后续接入 admin 服务 CRUD API。
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button>新建意图</Button>
        </PageActions>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>全部意图</CardTitle>
          <CardDescription>演示数据，等待后端模型稳定后接入。</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>归属场景</TableHead>
                <TableHead>样例数</TableHead>
                <TableHead>状态</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {intentions.map((intention) => (
                <TableRow key={intention.id}>
                  <TableCell className="font-medium">
                    {intention.name}
                  </TableCell>
                  <TableCell>{intention.scene}</TableCell>
                  <TableCell>{intention.examples}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        intention.status === "启用" ? "default" : "secondary"
                      }
                    >
                      {intention.status}
                    </Badge>
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
