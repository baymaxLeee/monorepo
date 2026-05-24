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
} from "@packages/components";
import {
  bulkDeleteScenes,
  createScene,
  deleteScene,
  fetchScenes,
  type AdminResource,
  updateScene,
} from "@packages/api";

const sceneSchema = z.object({
  name: z.string().trim().min(1, "请输入名称").max(100),
  description: z.string().max(500),
  status: z.enum(["draft", "active", "disabled"]),
  is_enabled: z.boolean(),
});

type SceneValues = z.infer<typeof sceneSchema>;

const defaults: SceneValues = {
  name: "",
  description: "",
  status: "draft",
  is_enabled: true,
};

function statusBadge(item: AdminResource) {
  if (!item.is_enabled) return <Badge variant="secondary">停用</Badge>;
  const labels = { active: "启用", draft: "草稿", disabled: "停用" };
  return <Badge variant={item.status === "active" ? "default" : "secondary"}>{labels[item.status]}</Badge>;
}

export function ScenesPage() {
  const [scenes, setScenes] = useState<AdminResource[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<AdminResource | null>(null);
  const [detail, setDetail] = useState<AdminResource | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const form = useForm<SceneValues>({
    resolver: zodResolver(sceneSchema),
    defaultValues: defaults,
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchScenes()
      .then((rows) => {
        setScenes(rows);
        setSelectedIds((ids) => ids.filter((id) => rows.some((row) => row.id === id)));
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

  function openEdit(scene: AdminResource) {
    setCreateOpen(false);
    setEditing(scene);
    form.reset({
      name: scene.name,
      description: scene.description,
      status: scene.status,
      is_enabled: scene.is_enabled,
    });
  }

  async function save(values: SceneValues) {
    try {
      if (editing) {
        await updateScene(editing.id, values);
        toast.success("场景已更新");
        setEditing(null);
      } else {
        await createScene(values);
        toast.success("场景已创建");
        setCreateOpen(false);
      }
      form.reset(defaults);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function remove(scene: AdminResource) {
    if (!window.confirm(`确认删除「${scene.name}」？`)) return;
    await deleteScene(scene.id);
    toast.success("场景已删除");
    load();
  }

  async function removeSelected() {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`确认删除选中的 ${selectedIds.length} 条场景？`)) return;
    const result = await bulkDeleteScenes(selectedIds);
    toast.success(`已删除 ${result.deleted} 条场景`);
    setSelectedIds([]);
    load();
  }

  function toggle(id: string) {
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>场景管理</PageTitle>
          <PageDescription>
            配置业务场景、归属用户和启停状态。
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>刷新</Button>
          <Button variant="destructive" onClick={removeSelected} disabled={selectedIds.length === 0}>批量删除</Button>
          <Button onClick={openCreate}>新建场景</Button>
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
          <CardTitle>全部场景</CardTitle>
          <CardDescription>{loading ? "加载中…" : scenes ? `共 ${scenes.length} 条` : "暂无数据"}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : scenes && scenes.length > 0 ? (
            <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">选择</TableHead>
                <TableHead>名称</TableHead>
                <TableHead>用户名</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenes.map((scene) => (
                <TableRow key={scene.id}>
                  <TableCell>
                    <input type="checkbox" checked={selectedIds.includes(scene.id)} onChange={() => toggle(scene.id)} />
                  </TableCell>
                  <TableCell className="font-medium">{scene.name}</TableCell>
                  <TableCell>{scene.username}</TableCell>
                  <TableCell>{statusBadge(scene)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(scene.updated_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="space-x-1 text-right">
                    <Button variant="link" size="sm" onClick={() => setDetail(scene)}>详情</Button>
                    <Button variant="link" size="sm" onClick={() => openEdit(scene)}>编辑</Button>
                    <Button variant="link" size="sm" onClick={() => remove(scene)}>删除</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          ) : (
            <Muted>列表为空，可点击「新建场景」添加。</Muted>
          )}
        </CardContent>
      </Card>

      <SceneFormDialog
        open={createOpen || Boolean(editing)}
        title={editing ? "编辑场景" : "新建场景"}
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
      <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
            <DialogDescription>场景详情</DialogDescription>
          </DialogHeader>
          {detail && (
            <div className="space-y-2 text-sm">
              <p>用户：{detail.username}</p>
              <p>状态：{detail.status} / {detail.is_enabled ? "启用" : "停用"}</p>
              <p>描述：{detail.description || "无"}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function SceneFormDialog({
  form,
  onOpenChange,
  onSubmit,
  open,
  title,
}: {
  form: ReturnType<typeof useForm<SceneValues>>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: SceneValues) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>维护场景名称、状态和描述。</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FieldGroup>
              <FormField control={form.control} name="name" render={({ field }) => (
                <Field><FieldLabel>名称</FieldLabel><FormControl><Input {...field} /></FormControl><FieldError errors={[form.formState.errors.name]} /></Field>
              )} />
              <FormField control={form.control} name="description" render={({ field }) => (
                <Field><FieldLabel>描述</FieldLabel><FormControl><Textarea {...field} /></FormControl><FieldError errors={[form.formState.errors.description]} /></Field>
              )} />
              <FormField control={form.control} name="status" render={({ field }) => (
                <Field><FieldLabel>状态</FieldLabel><FormControl><select className="h-9 rounded-md border bg-background px-3 text-sm" {...field}><option value="draft">草稿</option><option value="active">启用</option><option value="disabled">停用</option></select></FormControl></Field>
              )} />
              <FormField control={form.control} name="is_enabled" render={({ field }) => (
                <Field><FieldLabel><input type="checkbox" className="mr-2" checked={field.value} onChange={(e) => field.onChange(e.target.checked)} />是否启用</FieldLabel></Field>
              )} />
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
              <Button type="submit" disabled={form.formState.isSubmitting}>保存</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
