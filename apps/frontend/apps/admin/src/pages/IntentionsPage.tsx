import { useCallback, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
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
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Form,
  FormControl,
  FormField,
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
  Textarea,
  toast,
} from "components";
import {
  bulkDeleteIntentions,
  createIntention,
  deleteIntention,
  fetchIntentions,
  type Intention,
  updateIntention,
} from "api";

const intentionSchema = z.object({
  name: z.string().trim().min(1, "请输入名称").max(100),
  description: z.string().max(500),
  scene_name: z.string().max(100),
  examples: z.number().int().min(0),
  status: z.enum(["draft", "active", "disabled"]),
  is_enabled: z.boolean(),
});

type IntentionValues = z.infer<typeof intentionSchema>;

const defaults: IntentionValues = {
  name: "",
  description: "",
  scene_name: "",
  examples: 0,
  status: "draft",
  is_enabled: true,
};

function statusBadge(item: Intention) {
  if (!item.is_enabled) return <Badge variant="secondary">停用</Badge>;
  const labels = { active: "启用", draft: "草稿", disabled: "停用" };
  return (
    <Badge variant={item.status === "active" ? "default" : "secondary"}>
      {labels[item.status]}
    </Badge>
  );
}

export function IntentionsPage() {
  const [intentions, setIntentions] = useState<Intention[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Intention | null>(null);
  const [detail, setDetail] = useState<Intention | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const form = useForm<IntentionValues>({
    resolver: zodResolver(intentionSchema),
    defaultValues: defaults,
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchIntentions()
      .then((rows) => {
        setIntentions(rows);
        setSelectedIds((ids) =>
          ids.filter((id) => rows.some((row) => row.id === id)),
        );
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    form.reset(defaults);
    setCreateOpen(true);
  }

  function openEdit(intention: Intention) {
    setCreateOpen(false);
    setEditing(intention);
    form.reset({
      name: intention.name,
      description: intention.description,
      scene_name: intention.scene_name,
      examples: intention.examples,
      status: intention.status,
      is_enabled: intention.is_enabled,
    });
  }

  async function save(values: IntentionValues) {
    try {
      if (editing) {
        await updateIntention(editing.id, values);
        toast.success("意图已更新");
        setEditing(null);
      } else {
        await createIntention(values);
        toast.success("意图已创建");
        setCreateOpen(false);
      }
      form.reset(defaults);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function remove(intention: Intention) {
    if (!window.confirm(`确认删除「${intention.name}」？`)) return;
    await deleteIntention(intention.id);
    toast.success("意图已删除");
    load();
  }

  async function removeSelected() {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 条意图？`))
      return;
    const result = await bulkDeleteIntentions(selectedIds);
    toast.success(`已删除 ${result.deleted} 条意图`);
    setSelectedIds([]);
    load();
  }

  function toggle(id: string) {
    setSelectedIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>意图管理</PageTitle>
          <PageDescription>
            管理意图名称、归属场景、样例数量和启停状态。
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
          <Button
            variant="destructive"
            onClick={removeSelected}
            disabled={selectedIds.length === 0}
          >
            批量删除
          </Button>
          <Button onClick={openCreate}>新建意图</Button>
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
          <CardTitle>全部意图</CardTitle>
          <CardDescription>
            {loading
              ? "加载中…"
              : intentions
                ? `共 ${intentions.length} 条`
                : "暂无数据"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : intentions && intentions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">选择</TableHead>
                  <TableHead>名称</TableHead>
                  <TableHead>归属场景</TableHead>
                  <TableHead>样例数</TableHead>
                  <TableHead>用户名</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {intentions.map((intention) => (
                  <TableRow key={intention.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(intention.id)}
                        onChange={() => toggle(intention.id)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {intention.name}
                    </TableCell>
                    <TableCell>{intention.scene_name || "-"}</TableCell>
                    <TableCell>{intention.examples}</TableCell>
                    <TableCell>{intention.username}</TableCell>
                    <TableCell>{statusBadge(intention)}</TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setDetail(intention)}
                      >
                        详情
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => openEdit(intention)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => remove(intention)}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Muted>列表为空，可点击「新建意图」添加。</Muted>
          )}
        </CardContent>
      </Card>

      <IntentionFormDialog
        open={createOpen || Boolean(editing)}
        title={editing ? "编辑意图" : "新建意图"}
        form={form}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditing(null);
            form.reset(defaults);
          }
        }}
        onSubmit={save}
      />
      <Dialog
        open={Boolean(detail)}
        onOpenChange={(open) => !open && setDetail(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
            <DialogDescription>意图详情</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-2 text-sm">
              <p>用户：{detail.username}</p>
              <p>场景：{detail.scene_name || "-"}</p>
              <p>样例数：{detail.examples}</p>
              <p>
                状态：{detail.status} / {detail.is_enabled ? "启用" : "停用"}
              </p>
              <p>描述：{detail.description || "无"}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function IntentionFormDialog({
  form,
  onOpenChange,
  onSubmit,
  open,
  title,
}: {
  form: ReturnType<typeof useForm<IntentionValues>>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: IntentionValues) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            维护意图名称、场景、样例数和状态。
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FieldGroup>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>名称</FieldLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.name]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="scene_name"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>归属场景</FieldLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.scene_name]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="examples"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>样例数</FieldLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        {...field}
                        onChange={(e) => field.onChange(Number(e.target.value))}
                      />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.examples]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>描述</FieldLabel>
                    <FormControl>
                      <Textarea {...field} />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.description]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>状态</FieldLabel>
                    <FormControl>
                      <select
                        className="h-9 rounded-md border bg-background px-3 text-sm"
                        {...field}
                      >
                        <option value="draft">草稿</option>
                        <option value="active">启用</option>
                        <option value="disabled">停用</option>
                      </select>
                    </FormControl>
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="is_enabled"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>
                      <input
                        type="checkbox"
                        className="mr-2"
                        checked={field.value}
                        onChange={(e) => field.onChange(e.target.checked)}
                      />
                      是否启用
                    </FieldLabel>
                  </Field>
                )}
              />
            </FieldGroup>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
