import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Bot,
  createBot,
  deleteBot,
  fetchBots,
  fetchModelProviders,
  type ModelProvider,
} from "api";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogBody,
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
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { getErrorMessage } from "shared";
import { z } from "zod";
import { useShallow } from "zustand/react/shallow";
import { AgentModelDialog } from "../components/AgentModelDialog";
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
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Bot | null>(null);
  const [deleting, setDeleting] = useState<Bot | null>(null);
  const { createOpen, setCreateOpen } = useAdminStore(
    useShallow((state) => ({
      createOpen: state.createDialogOpen,
      setCreateOpen: state.setCreateDialogOpen,
    })),
  );

  const form = useForm<CreateBotValues>({
    resolver: zodResolver(createBotSchema as never),
    defaultValues: { name: "" },
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      fetchBots({ skipErrorNotify: true }),
      fetchModelProviders({ skipErrorNotify: true }).catch(() => []),
    ])
      .then(([botList, providerList]) => {
        setBots(botList);
        setProviders(providerList);
      })
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const providerLabel = useCallback(
    (id: string | null) => {
      if (!id) return "—";
      return providers.find((p) => p.id === id)?.name ?? id;
    },
    [providers],
  );

  async function onDelete() {
    if (!deleting) return;
    try {
      await deleteBot(deleting.id);
      toast.success("智能体已删除");
      setDeleting(null);
      load();
    } catch {}
  }

  async function onCreate(values: CreateBotValues) {
    try {
      await createBot({ name: values.name.trim() });
      toast.success("智能体已创建");
      form.reset();
      setCreateOpen(false);
      load();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>智能体</PageTitle>
          <PageDescription>
            配置每个智能体的文本 / 图片 / 视频模型；对话时按智能体消费。
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
                  先创建智能体，再在「配置」中选择其使用的模型。
                </DialogDescription>
              </DialogHeader>
              <DialogBody>
                <Form {...form}>
                  <form
                    id="bot-create-form"
                    onSubmit={form.handleSubmit(onCreate)}
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
                  </form>
                </Form>
              </DialogBody>
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
                  form="bot-create-form"
                  disabled={form.formState.isSubmitting}
                >
                  {form.formState.isSubmitting ? "创建中…" : "创建"}
                </Button>
              </DialogFooter>
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
                  <TableHead>文本模型</TableHead>
                  <TableHead>图片模型</TableHead>
                  <TableHead>视频模型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bots.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {providerLabel(b.text_provider_id)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {providerLabel(b.image_provider_id)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {providerLabel(b.video_provider_id)}
                    </TableCell>
                    <TableCell>{statusBadge(b.status)}</TableCell>
                    <TableCell className="space-x-2 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditing(b)}
                      >
                        配置
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleting(b)}
                      >
                        删除
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

      <AgentModelDialog
        bot={editing}
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        providers={providers}
        onSaved={load}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除智能体</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除「{deleting?.name}」？此操作不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onDelete}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
