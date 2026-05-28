import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreateModelProviderInput,
  createModelProvider,
  deleteModelProvider,
  fetchModelProviders,
  type ModelProvider,
  setDefaultModelProvider,
  type TestModelProviderResult,
  testModelProvider,
  updateModelProvider,
} from "api";
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
  Textarea,
  toast,
} from "components";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const providerSchema = z.object({
  name: z.string().trim().min(1, "请输入名称").max(100),
  model: z.string().trim().min(1, "请输入模型名").max(128),
  base_url: z.string().trim().url("base_url 必须是合法 URL"),
  // Optional in edit mode (leave empty to keep current key).
  api_key: z.string().max(4096),
  extra_body: z
    .string()
    .max(8000)
    .refine(
      (raw) => {
        const trimmed = raw.trim();
        if (!trimmed) return true;
        try {
          const parsed = JSON.parse(trimmed);
          return (
            parsed !== null &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
          );
        } catch {
          return false;
        }
      },
      { message: "extra_body 必须是合法 JSON 对象，留空等价于 {}" },
    ),
  is_default: z.boolean(),
  is_enabled: z.boolean(),
});

type ProviderValues = z.infer<typeof providerSchema>;

const defaults: ProviderValues = {
  name: "",
  model: "",
  base_url: "https://api.deepseek.com",
  api_key: "",
  extra_body: "",
  is_default: false,
  is_enabled: true,
};

function parseExtraBody(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function stringifyExtraBody(value: Record<string, unknown>): string {
  if (!value || Object.keys(value).length === 0) return "";
  return JSON.stringify(value, null, 2);
}

function statusBadge(item: ModelProvider) {
  if (!item.is_enabled) return <Badge variant="secondary">停用</Badge>;
  if (item.is_default) return <Badge>默认</Badge>;
  return <Badge variant="outline">启用</Badge>;
}

export function ProvidersPage() {
  const [providers, setProviders] = useState<ModelProvider[] | null>(null);
  const [editing, setEditing] = useState<ModelProvider | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    provider: ModelProvider;
    result: TestModelProviderResult;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm<ProviderValues>({
    resolver: zodResolver(providerSchema as never),
    defaultValues: defaults,
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchModelProviders()
      .then(setProviders)
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

  function openEdit(provider: ModelProvider) {
    setCreateOpen(false);
    setEditing(provider);
    form.reset({
      name: provider.name,
      model: provider.model,
      base_url: provider.base_url,
      // Never echo the stored key back — even masked. Empty here means
      // "keep the existing encrypted value".
      api_key: "",
      extra_body: stringifyExtraBody(provider.extra_body ?? {}),
      is_default: provider.is_default,
      is_enabled: provider.is_enabled,
    });
  }

  async function save(values: ProviderValues) {
    try {
      const extra_body = parseExtraBody(values.extra_body);
      if (editing) {
        const patch: Parameters<typeof updateModelProvider>[1] = {
          name: values.name,
          model: values.model,
          base_url: values.base_url,
          extra_body,
          is_default: values.is_default,
          is_enabled: values.is_enabled,
        };
        if (values.api_key.trim()) patch.api_key = values.api_key.trim();
        await updateModelProvider(editing.id, patch);
        toast.success("模型已更新");
        setEditing(null);
      } else {
        if (!values.api_key.trim()) {
          form.setError("api_key", { message: "新建时必须填入 API Key" });
          return;
        }
        const payload: CreateModelProviderInput = {
          name: values.name,
          model: values.model,
          base_url: values.base_url,
          api_key: values.api_key.trim(),
          extra_body,
          is_default: values.is_default,
          is_enabled: values.is_enabled,
        };
        await createModelProvider(payload);
        toast.success("模型已创建");
        setCreateOpen(false);
      }
      form.reset(defaults);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function remove(provider: ModelProvider) {
    if (!window.confirm(`确认删除「${provider.name}」？`)) return;
    await deleteModelProvider(provider.id);
    toast.success("已删除");
    load();
  }

  async function markDefault(provider: ModelProvider) {
    try {
      await setDefaultModelProvider(provider.id);
      toast.success(`「${provider.name}」已设为默认`);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function runTest(provider: ModelProvider) {
    setTestingId(provider.id);
    setTestResult(null);
    try {
      const result = await testModelProvider(provider.id, {});
      setTestResult({ provider, result });
      if (result.ok) {
        toast.success(`连通成功（${result.latency_ms ?? "?"} ms）`);
      } else {
        toast.error(`连通失败：${result.error ?? "unknown"}`);
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setTestingId(null);
    }
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>模型管理</PageTitle>
          <PageDescription>
            配置 OpenAI 兼容的模型 Provider（DeepSeek / OpenAI /
            自建网关等），API Key 在 admin 服务内加密存储，仅在调用时由 consumer
            服务（如 chat）通过内部接口取回。
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
          <Button onClick={openCreate}>新增模型</Button>
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
          <CardTitle>全部 Provider</CardTitle>
          <CardDescription>
            {loading
              ? "加载中…"
              : providers
                ? `共 ${providers.length} 条`
                : "暂无数据"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : providers && providers.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>模型</TableHead>
                  <TableHead>Base URL</TableHead>
                  <TableHead>API Key</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell className="font-medium">
                      {provider.name}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {provider.model}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {provider.base_url}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {provider.api_key_masked}
                    </TableCell>
                    <TableCell>{statusBadge(provider)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(provider.updated_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => runTest(provider)}
                        disabled={testingId === provider.id}
                      >
                        {testingId === provider.id ? "测试中…" : "测试"}
                      </Button>
                      {!provider.is_default && provider.is_enabled && (
                        <Button
                          variant="link"
                          size="sm"
                          onClick={() => markDefault(provider)}
                        >
                          设默认
                        </Button>
                      )}
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => openEdit(provider)}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => remove(provider)}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Muted>
              还没有任何模型 Provider。点击「新增模型」配置你的第一个 OpenAI
              兼容端点。
            </Muted>
          )}
        </CardContent>
      </Card>

      <ProviderFormDialog
        open={createOpen || Boolean(editing)}
        title={editing ? "编辑模型 Provider" : "新增模型 Provider"}
        isEditing={Boolean(editing)}
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
        open={Boolean(testResult)}
        onOpenChange={(open) => !open && setTestResult(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {testResult?.provider.name}{" "}
              {testResult?.result.ok ? (
                <Badge className="ml-2">OK</Badge>
              ) : (
                <Badge variant="destructive" className="ml-2">
                  FAIL
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>连通性测试结果</DialogDescription>
          </DialogHeader>
          {testResult && (
            <div className="space-y-2 text-sm">
              {testResult.result.ok ? (
                <>
                  <p>
                    延迟：
                    <span className="font-mono">
                      {testResult.result.latency_ms ?? "?"} ms
                    </span>
                  </p>
                  {testResult.result.sample && (
                    <p>
                      首条回复：
                      <code className="rounded bg-muted px-1 py-0.5">
                        {testResult.result.sample}
                      </code>
                    </p>
                  )}
                </>
              ) : (
                <pre className="whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                  {testResult.result.error}
                </pre>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Page>
  );
}

function ProviderFormDialog({
  form,
  isEditing,
  onOpenChange,
  onSubmit,
  open,
  title,
}: {
  form: ReturnType<typeof useForm<ProviderValues>>;
  isEditing: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: ProviderValues) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            配置 OpenAI 兼容端点。base_url 不带末尾斜杠；api_key
            提交后将被加密存储，列表中仅显示前后 4 位掩码。
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
                      <Input
                        {...field}
                        placeholder="例如：DeepSeek V4（个人）"
                      />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.name]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="model"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>模型 (model)</FieldLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="例如：deepseek-chat / deepseek-v4-pro / gpt-4o"
                      />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.model]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="base_url"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>Base URL</FieldLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="https://api.deepseek.com"
                      />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.base_url]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="api_key"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>
                      API Key{" "}
                      {isEditing && (
                        <span className="text-xs font-normal text-muted-foreground">
                          （留空 = 保留原 key）
                        </span>
                      )}
                    </FieldLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="password"
                        autoComplete="off"
                        placeholder={isEditing ? "保持不变请留空" : "sk-..."}
                      />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.api_key]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="extra_body"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>extra_body（可选 JSON 对象）</FieldLabel>
                    <FormControl>
                      <Textarea
                        {...field}
                        rows={4}
                        className="font-mono text-xs"
                        placeholder={`{\n  "thinking": {"type": "enabled"}\n}`}
                      />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.extra_body]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="is_default"
                render={({ field }) => (
                  <Field>
                    <FieldLabel className="flex items-center gap-2">
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                      设为默认
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
