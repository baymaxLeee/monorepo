import { zodResolver } from "@hookform/resolvers/zod";
import { type AppEntry, createApp, deleteApp, fetchApps, updateApp } from "api";
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
  Switch,
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
import { z } from "zod";

const appSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1, "请输入标识")
    .max(64)
    .regex(/^[a-z0-9-]+$/, "仅小写字母、数字、连字符"),
  title: z.string().trim().min(1, "请输入名称").max(120),
  base_path: z.string().trim().min(1, "请输入路径").max(200),
  remote_name: z.string().trim().min(1, "请输入 remote 名").max(120),
  expose_key: z.string().trim().min(1).max(120),
  entry: z.string().trim().max(500),
  requires_admin: z.boolean(),
  is_enabled: z.boolean(),
  sort_order: z.coerce.number().int().min(0),
});

type AppValues = z.infer<typeof appSchema>;

const defaults: AppValues = {
  id: "",
  title: "",
  base_path: "/platform/",
  remote_name: "",
  expose_key: "./App",
  entry: "",
  requires_admin: true,
  is_enabled: true,
  sort_order: 0,
};

export function AppsRegistryPage() {
  const [apps, setApps] = useState<AppEntry[] | null>(null);
  const [editing, setEditing] = useState<AppEntry | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const form = useForm<AppValues>({
    resolver: zodResolver(appSchema as never),
    defaultValues: defaults,
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchApps()
      .then(setApps)
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

  function openEdit(app: AppEntry) {
    setCreateOpen(false);
    setEditing(app);
    form.reset({
      id: app.id,
      title: app.title,
      base_path: app.base_path,
      remote_name: app.remote_name,
      expose_key: app.expose_key,
      entry: app.entry,
      requires_admin: app.requires_admin,
      is_enabled: app.is_enabled,
      sort_order: app.sort_order,
    });
  }

  async function save(values: AppValues) {
    try {
      if (editing) {
        await updateApp(editing.id, {
          title: values.title,
          base_path: values.base_path,
          remote_name: values.remote_name,
          expose_key: values.expose_key,
          entry: values.entry,
          requires_admin: values.requires_admin,
          is_enabled: values.is_enabled,
          sort_order: values.sort_order,
        });
        toast.success("应用已更新");
        setEditing(null);
      } else {
        await createApp(values);
        toast.success("应用已创建");
        setCreateOpen(false);
      }
      form.reset(defaults);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function patch(app: AppEntry, values: Partial<AppEntry>) {
    try {
      await updateApp(app.id, values);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function remove(app: AppEntry) {
    if (!window.confirm(`确认删除应用「${app.title}」？`)) return;
    await deleteApp(app.id);
    toast.success("应用已删除");
    load();
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>应用入口管理</PageTitle>
          <PageDescription>
            配置平台可挂载的微前端入口。「对普通用户开放」关闭时该应用仅管理员可见。
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
          <Button onClick={openCreate}>新建应用</Button>
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
          <CardTitle>全部应用</CardTitle>
          <CardDescription>
            {loading ? "加载中…" : apps ? `共 ${apps.length} 个` : "暂无数据"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : apps && apps.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>标识 / 路径</TableHead>
                  <TableHead>Remote</TableHead>
                  <TableHead className="text-center">对普通用户开放</TableHead>
                  <TableHead className="text-center">启用</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.map((app) => (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium">{app.title}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <div>{app.id}</div>
                      <div className="text-xs">{app.base_path}</div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{app.remote_name}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={!app.requires_admin}
                        onCheckedChange={(open) =>
                          patch(app, { requires_admin: !open })
                        }
                      />
                    </TableCell>
                    <TableCell className="text-center">
                      <Switch
                        checked={app.is_enabled}
                        onCheckedChange={(v) => patch(app, { is_enabled: v })}
                      />
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => openEdit(app)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => remove(app)}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Muted>列表为空，可点击「新建应用」添加。</Muted>
          )}
        </CardContent>
      </Card>

      <AppFormDialog
        open={createOpen || Boolean(editing)}
        title={editing ? "编辑应用" : "新建应用"}
        editing={Boolean(editing)}
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
    </Page>
  );
}

function AppFormDialog({
  editing,
  form,
  onOpenChange,
  onSubmit,
  open,
  title,
}: {
  editing: boolean;
  form: ReturnType<typeof useForm<AppValues>>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: AppValues) => void;
  open: boolean;
  title: string;
}) {
  const textField = (
    name: keyof AppValues,
    label: string,
    opts: { disabled?: boolean; placeholder?: string } = {},
  ) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <Field>
          <FieldLabel>{label}</FieldLabel>
          <FormControl>
            <Input
              {...field}
              value={String(field.value ?? "")}
              disabled={opts.disabled}
              placeholder={opts.placeholder}
            />
          </FormControl>
          <FieldError errors={[form.formState.errors[name]]} />
        </Field>
      )}
    />
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            维护微前端入口的挂载信息与可见性。
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FieldGroup>
              {textField("id", "标识（slug）", {
                disabled: editing,
                placeholder: "admin",
              })}
              {textField("title", "名称", { placeholder: "后台管理" })}
              {textField("base_path", "挂载路径", {
                placeholder: "/platform/admin",
              })}
              {textField("remote_name", "Remote 名", {
                placeholder: "mfe_admin",
              })}
              {textField("expose_key", "Expose Key", {
                placeholder: "./App",
              })}
              {textField("entry", "Manifest 入口 URL", {
                placeholder: "http://localhost:3001/mf-manifest.json",
              })}
              {textField("sort_order", "排序")}
              <FormField
                control={form.control}
                name="requires_admin"
                render={({ field }) => (
                  <Field>
                    <FieldLabel className="flex items-center gap-2">
                      <Switch
                        checked={!field.value}
                        onCheckedChange={(open) => field.onChange(!open)}
                      />
                      对普通用户开放
                    </FieldLabel>
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="is_enabled"
                render={({ field }) => (
                  <Field>
                    <FieldLabel className="flex items-center gap-2">
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                      启用
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

export default AppsRegistryPage;
