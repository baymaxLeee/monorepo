import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@packages/components";
import { createBot, fetchBots, type Bot } from "@packages/api-client/admin";

function statusBadge(status: Bot["status"]) {
  const variants: Record<Bot["status"], "default" | "secondary" | "outline"> = {
    published: "default",
    draft: "secondary",
    archived: "outline",
  };
  const labels: Record<Bot["status"], string> = {
    published: "已发布",
    draft: "草稿",
    archived: "已归档",
  };
  return <Badge variant={variants[status]}>{labels[status]}</Badge>;
}

export function BotListPage() {
  const [bots, setBots] = useState<Bot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchBots()
      .then(setBots)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createBot({ name });
      setNewName("");
      setCreateOpen(false);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">智能体列表</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            数据来自 <code className="rounded bg-muted px-1.5 py-0.5 text-xs">GET /v1/bots</code>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>新建智能体</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建智能体</DialogTitle>
                <DialogDescription>名称将提交到 admin 服务并写入 MySQL。</DialogDescription>
              </DialogHeader>
              <div className="grid gap-2 py-2">
                <Label htmlFor="bot-name">名称</Label>
                <Input
                  id="bot-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如：客服助手"
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateOpen(false)}>
                  取消
                </Button>
                <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
                  {creating ? "创建中…" : "创建"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>请求失败</AlertTitle>
          <AlertDescription>
            {error}
            <br />
            <span className="text-xs">
              请确认 <code className="rounded bg-muted px-1 py-0.5">just up</code> 与{" "}
              <code className="rounded bg-muted px-1 py-0.5">just dev</code> 已启动 gateway / admin。
            </span>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>全部智能体</CardTitle>
          <CardDescription>
            {loading ? "加载中…" : bots ? `共 ${bots.length} 条` : "暂无数据"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bots && bots.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bots.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>{statusBadge(b.status)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(b.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="link" size="sm" asChild>
                        <Link to={b.id} relative="path">
                          详情
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            !loading && (
              <p className="text-sm text-muted-foreground">列表为空，可点击「新建智能体」添加。</p>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}
