import { useState } from "react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  InlineCode,
  Page,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "components";

export function ComponentsDemoPage() {
  const [notify, setNotify] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [role, setRole] = useState("editor");

  return (
    <Page className="space-y-8">
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>shadcn 组件演示</PageTitle>
          <PageDescription>
            来自 <InlineCode>components</InlineCode>
            ，主题由 <InlineCode>styles.css</InlineCode> 注入
          </PageDescription>
        </PageHeaderContent>
      </PageHeader>

      <Alert>
        <AlertTitle>提示</AlertTitle>
        <AlertDescription>
          切换下方 Tab
          查看不同类别的组件；表单控件可与「智能体」页的创建弹窗对照使用。
        </AlertDescription>
      </Alert>

      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic">基础</TabsTrigger>
          <TabsTrigger value="form">表单</TabsTrigger>
          <TabsTrigger value="overlay">浮层</TabsTrigger>
          <TabsTrigger value="data">数据</TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Button & Badge</CardTitle>
              <CardDescription>常用操作与状态标签</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button>默认</Button>
              <Button variant="secondary">次要</Button>
              <Button variant="outline">描边</Button>
              <Button variant="ghost">幽灵</Button>
              <Button variant="destructive">危险</Button>
              <Button variant="link">链接</Button>
              <Separator orientation="vertical" className="h-8" />
              <Badge>默认</Badge>
              <Badge variant="secondary">草稿</Badge>
              <Badge variant="outline">已归档</Badge>
              <Badge variant="destructive">异常</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Avatar & Tooltip</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-6">
              <Avatar>
                <AvatarImage
                  src="https://api.dicebear.com/7.x/shapes/svg?seed=admin"
                  alt="demo"
                />
                <AvatarFallback>AD</AvatarFallback>
              </Avatar>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="outline">悬停查看</Button>
                </TooltipTrigger>
                <TooltipContent>Tooltip 来自 Radix + Tailwind</TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="form" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>表单控件</CardTitle>
              <CardDescription>
                Input、Select、Checkbox、Switch、Textarea
              </CardDescription>
            </CardHeader>
            <CardContent className="grid max-w-md gap-5">
              <div className="grid gap-2">
                <Label htmlFor="demo-name">名称</Label>
                <Input id="demo-name" placeholder="智能体名称" />
              </div>
              <div className="grid gap-2">
                <Label>角色</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择角色" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">只读</SelectItem>
                    <SelectItem value="editor">编辑</SelectItem>
                    <SelectItem value="admin">管理员</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="demo-notes">备注</Label>
                <Textarea id="demo-notes" placeholder="可选说明…" rows={3} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="notify"
                  checked={notify}
                  onCheckedChange={(v) => setNotify(v === true)}
                />
                <Label htmlFor="notify" className="font-normal">
                  启用通知
                </Label>
              </div>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="space-y-0.5">
                  <Label htmlFor="marketing">营销邮件</Label>
                  <p className="text-xs text-muted-foreground">每月最多一封</p>
                </div>
                <Switch
                  id="marketing"
                  checked={marketing}
                  onCheckedChange={(v) => setMarketing(v === true)}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button type="button">保存（演示）</Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="overlay" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Dialog</CardTitle>
              <CardDescription>模态对话框，带进入/退出动画</CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog>
                <DialogTrigger asChild>
                  <Button>打开 Dialog</Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>确认操作</DialogTitle>
                    <DialogDescription>
                      这是 shadcn Dialog 演示，点击遮罩或关闭按钮可退出。
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline">取消</Button>
                    <Button>确认</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>DropdownMenu</CardTitle>
            </CardHeader>
            <CardContent>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">打开菜单</Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuLabel>账户</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem>个人资料</DropdownMenuItem>
                  <DropdownMenuItem>设置</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem
                    checked={notify}
                    onCheckedChange={(v) => setNotify(v === true)}
                  >
                    通知
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuItem className="text-destructive">
                    退出登录
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Table</CardTitle>
              <CardDescription>静态示例数据</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">版本</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[
                    { name: "客服助手", status: "published", version: "v3" },
                    { name: "销售 Bot", status: "draft", version: "v1" },
                    { name: "归档示例", status: "archived", version: "v2" },
                  ].map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell>
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {row.version}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </Page>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, "default" | "secondary" | "outline"> = {
    published: "default",
    draft: "secondary",
    archived: "outline",
  };
  const label: Record<string, string> = {
    published: "已发布",
    draft: "草稿",
    archived: "已归档",
  };
  return (
    <Badge variant={map[status] ?? "outline"}>{label[status] ?? status}</Badge>
  );
}
