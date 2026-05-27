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
  CodeEditor,
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
  FileWorkspace,
  Input,
  Label,
  MarkdownEditor,
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
  PdfPreviewer,
  XMindPreviewer,
  InlineCode,
  Page,
  PageDescription,
  PageHeader,
  PageHeaderContent,
  PageTitle,
} from "components";
import type { FileChange, FileNode, XMindPreviewerProps } from "components";

const demoCode = `import { apiHttp } from "api";

export async function loadBotMetrics(botId: string) {
  const { data } = await apiHttp.get(\`/api/admin-server/bot/\${botId}/metrics\`);

  return {
    successRate: data.success_rate ?? 0,
    averageLatency: data.avg_latency_ms ?? 0,
    totalSessions: data.total_sessions ?? 0,
  };
}
`;

const demoMarkdown = `# 智能体发布说明

本次发布包含三个核心能力：

- 支持按租户隔离知识库
- 新增人工接管触发条件
- 优化召回日志与链路追踪

| 指标 | 发布前 | 发布后 |
| --- | ---: | ---: |
| 平均延迟 | 860ms | 520ms |
| 命中率 | 72% | 86% |
`;

const demoFileTree: FileNode[] = [
  {
    id: "src",
    name: "src",
    type: "directory",
    parent_id: null,
    children: [
      {
        id: "bot-config",
        name: "bot.config.json",
        type: "file",
        parent_id: "src",
        content: JSON.stringify(
          {
            name: "客服质检助手",
            model: "gpt-5-mini",
            tools: ["ticket.search", "order.lookup"],
            guardrails: {
              handoffScore: 0.78,
              maxTurns: 8,
            },
          },
          null,
          2,
        ),
      },
      {
        id: "prompt",
        name: "system-prompt.md",
        type: "file",
        parent_id: "src",
        content:
          "你是客服质检助手。先确认用户诉求，再根据工单、订单与知识库给出可执行建议。",
      },
    ],
  },
  {
    id: "README",
    name: "README.md",
    type: "file",
    parent_id: null,
    content:
      "# Bot Workspace\n\n这个目录演示 FileWorkspace 的目录树、多标签和代码编辑能力。",
  },
];

const demoMindMapData: NonNullable<XMindPreviewerProps["data"]> = {
  layout: "mindMap",
  theme: {
    template: "default",
  },
  root: {
    data: {
      text: "智能体上线检查",
      expand: true,
    },
    children: [
      {
        data: { text: "策略配置", expand: true },
        children: [
          { data: { text: "系统提示词" } },
          { data: { text: "工具权限" } },
          { data: { text: "兜底话术" } },
        ],
      },
      {
        data: { text: "观测指标", expand: true },
        children: [
          { data: { text: "成功率" } },
          { data: { text: "平均延迟" } },
          { data: { text: "人工接管率" } },
        ],
      },
      {
        data: { text: "发布流程", expand: true },
        children: [
          { data: { text: "灰度租户" } },
          { data: { text: "回滚预案" } },
        ],
      },
    ],
  },
};

const pdfWorkerSrc =
  "https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.mjs";

const demoPdfUrl =
  "https://mozilla.github.io/pdf.js/web/compressed.tracemonkey-pldi-09.pdf";

const demoTabs = [
  "basic",
  "form",
  "overlay",
  "data",
  "editors",
  "previewers",
] as const;

type DemoTab = (typeof demoTabs)[number];

const defaultDemoTab: DemoTab = "basic";

function resolveDemoTab(value: string | null): DemoTab {
  return demoTabs.includes(value as DemoTab)
    ? (value as DemoTab)
    : defaultDemoTab;
}

export function ComponentsDemoPage() {
  const [notify, setNotify] = useState(true);
  const [marketing, setMarketing] = useState(false);
  const [role, setRole] = useState("editor");
  const [codeValue, setCodeValue] = useState(demoCode);
  const [markdownValue, setMarkdownValue] = useState(demoMarkdown);
  const [lastFileChange, setLastFileChange] = useState<FileChange | null>(null);
  const [activeTab, setActiveTab] = useState<DemoTab>(defaultDemoTab);

  const handleTabChange = (value: string) => {
    setActiveTab(resolveDemoTab(value));
  };

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

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="basic">基础</TabsTrigger>
          <TabsTrigger value="form">表单</TabsTrigger>
          <TabsTrigger value="overlay">浮层</TabsTrigger>
          <TabsTrigger value="data">数据</TabsTrigger>
          <TabsTrigger value="editors">编辑器</TabsTrigger>
          <TabsTrigger value="previewers">预览</TabsTrigger>
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

        <TabsContent value="editors" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>CodeEditor</CardTitle>
              <CardDescription>
                CodeMirror 封装，示例数据为智能体指标加载函数
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <CodeEditor
                fileId="demo-bot-metrics"
                fileName="bot-metrics.ts"
                value={codeValue}
                onChange={setCodeValue}
                className="h-80 overflow-hidden rounded-md border"
              />
              <p className="text-xs text-muted-foreground">
                当前字符数：{codeValue.length}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>FileWorkspace</CardTitle>
              <CardDescription>
                目录树、多标签和代码编辑器组合，内置项目文件数据
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <FileWorkspace
                defaultValue={demoFileTree}
                defaultSelectedFileId="bot-config"
                height="420px"
                onChange={(change) => setLastFileChange(change)}
              />
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  最近一次变更
                </div>
                <pre className="overflow-auto text-xs leading-5">
                  {lastFileChange
                    ? JSON.stringify(lastFileChange, null, 2)
                    : "尚未修改文件"}
                </pre>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>MarkdownEditor</CardTitle>
              <CardDescription>
                TipTap 富文本 / Markdown 编辑器，示例数据为发布说明
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <MarkdownEditor
                value={markdownValue}
                contentType="markdown"
                editable
                onChange={setMarkdownValue}
                className="min-h-96 rounded-md border"
              />
              <div className="rounded-md border bg-muted/40 p-3">
                <div className="mb-2 text-xs font-medium text-muted-foreground">
                  Markdown 输出
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-xs leading-5">
                  {markdownValue}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="previewers" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>PdfPreviewer</CardTitle>
              <CardDescription>
                远程 PDF（pdf.js TraceMonkey 论文），展示页码、缩放、缩略图与关键字高亮
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PdfPreviewer
                file={demoPdfUrl}
                workerSrc={pdfWorkerSrc}
                height="520px"
                defaultSidebar="thumbnail"
                highlights={[
                  {
                    id: "summary-keyword",
                    keyword: "TraceMonkey",
                  },
                ]}
                toolbarExtraRender={() => (
                  <Badge variant="secondary">mozilla.github.io</Badge>
                )}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>XMindPreviewer</CardTitle>
              <CardDescription>
                simple-mind-map 预览，示例数据为智能体上线检查清单
              </CardDescription>
            </CardHeader>
            <CardContent>
              <XMindPreviewer
                data={demoMindMapData}
                height="520px"
                layout="mindMap"
                theme="default"
                toolbar
              />
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
