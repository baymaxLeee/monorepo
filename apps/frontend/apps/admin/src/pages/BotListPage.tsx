import { useCallback, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { z } from "zod";
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Form,
  FormControl,
  FormField,
  InlineCode,
  Input,
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
  toast,
} from "components";
import { createBot, fetchBots, type Bot } from "api";
import { useShallow } from "zustand/react/shallow";
import { useAdminStore } from "../store/useAdminStore";

const createBotSchema = z.object({
  name: z.string().trim().min(1, "请输入名称"),
});

type CreateBotValues = z.infer<typeof createBotSchema>;

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
  const { createOpen, setCreateOpen } = useAdminStore(
    useShallow((state) => ({
      createOpen: state.createDialogOpen,
      setCreateOpen: state.setCreateDialogOpen,
    })),
  );

  const form = useForm<CreateBotValues>({
    resolver: zodResolver(createBotSchema),
    defaultValues: { name: "" },
  });

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

  async function onCreate(values: CreateBotValues) {
    try {
      await createBot({ name: values.name.trim() });
      toast.success("智能体已创建");
      form.reset();
      setCreateOpen(false);
      load();
    } catch (e) {
      const message = String(e);
      toast.error(message);
      setError(message);
    }
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>智能体列表</PageTitle>
          <PageDescription>
            数据来自 <InlineCode>GET /api/admin-server/bot</InlineCode>
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
          <Dialog
            open={createOpen}
            onOpenChange={(open) => {
              setCreateOpen(open);
              if (!open) form.reset();
            }}
          >
            <DialogTrigger asChild>
              <Button>新建智能体</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>新建智能体</DialogTitle>
                <DialogDescription>
                  名称将提交到 admin 服务并写入 MySQL。
                </DialogDescription>
              </DialogHeader>
              <Form {...form}>
                <form
                  onSubmit={form.handleSubmit(onCreate)}
                  className="space-y-4"
                >
                  <FieldGroup>
                    <FormField
                      control={form.control}
                      name="name"
                      render={({ field }) => (
                        <Field>
                          <FieldLabel htmlFor="bot-name">名称</FieldLabel>
                          <FormControl>
                            <Input
                              id="bot-name"
                              placeholder="例如：客服助手"
                              {...field}
                            />
                          </FormControl>
                          <FieldError errors={[form.formState.errors.name]} />
                        </Field>
                      )}
                    />
                  </FieldGroup>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCreateOpen(false)}
                    >
                      取消
                    </Button>
                    <Button
                      type="submit"
                      disabled={form.formState.isSubmitting}
                    >
                      {form.formState.isSubmitting ? "创建中…" : "创建"}
                    </Button>
                  </DialogFooter>
                </form>
              </Form>
            </DialogContent>
          </Dialog>
        </PageActions>
      </PageHeader>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>请求失败</AlertTitle>
          <AlertDescription>
            {error}
            <br />
            <span className="text-xs">
              请确认 <InlineCode>just up</InlineCode> 与{" "}
              <InlineCode>just dev</InlineCode> 已启动 gateway / admin。
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
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-3/4" />
            </div>
          ) : bots && bots.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>创建时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bots.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell>{b.username}</TableCell>
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
            <Muted>列表为空，可点击「新建智能体」添加。</Muted>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
