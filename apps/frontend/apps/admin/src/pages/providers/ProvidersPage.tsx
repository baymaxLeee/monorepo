import { zodResolver } from "@hookform/resolvers/zod";
import {
  type CreateModelProviderInput,
  createModelProvider,
  deleteModelProvider,
  fetchModelProviders,
  type ModelProvider,
  type ProviderKind,
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
  DialogBody,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
import { getErrorMessage } from "shared";
import { z } from "zod";

import { resolveChatTokenBudget } from "./provider-token-budgets";

const providerSchema = z
  .object({
    name: z.string().trim().min(1, "请输入名称").max(100),
    provider_kind: z.enum(["chat", "image", "video", "embedding", "rerank"]),
    model: z.string().trim().min(1, "请输入模型名").max(128),
    base_url: z.string().trim().url("base_url 必须是合法 URL"),
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
    context_window: z.number().int().min(1024).max(2_000_000),
    max_output_tokens: z.number().int().min(256).max(1_000_000),
    supports_image_input: z.boolean(),
    is_default: z.boolean(),
    is_enabled: z.boolean(),
  })
  .refine((value) => value.max_output_tokens < value.context_window, {
    message: "最大输出必须小于上下文窗口",
    path: ["max_output_tokens"],
  })
  .refine((value) => value.provider_kind === "chat" || !value.is_default, {
    message: "仅对话类型可设为 chat 默认模型",
    path: ["is_default"],
  });

type ProviderValues = z.infer<typeof providerSchema>;

const ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

const kindPresets: Record<
  ProviderKind,
  Pick<ProviderValues, "base_url" | "model" | "extra_body">
> = {
  chat: {
    base_url: ARK_BASE_URL,
    model: "deepseek-v4-pro-260425",
    extra_body:
      '{\n  "thinking": {"type": "enabled"},\n  "reasoning_effort": "high"\n}',
  },
  image: {
    base_url: ARK_BASE_URL,
    model: "doubao-seedream-5-0-260128",
    extra_body:
      '{\n  "size": "2K",\n  "response_format": "url",\n  "watermark": true\n}',
  },
  video: {
    base_url: ARK_BASE_URL,
    model: "doubao-seedance-2-0-260128",
    extra_body:
      '{\n  "generate_audio": true,\n  "ratio": "9:16",\n  "resolution": "720p",\n  "watermark": false,\n  "framespersecond": 24\n}',
  },
  embedding: {
    base_url: ARK_BASE_URL,
    model: "doubao-embedding-text-240715",
    extra_body: "",
  },
  rerank: {
    base_url: ARK_BASE_URL,
    model: "doubao-rerank",
    extra_body: "",
  },
};

const kindLabels: Record<ProviderKind, string> = {
  chat: "对话",
  image: "图片生成",
  video: "视频生成",
  embedding: "向量嵌入",
  rerank: "重排",
};

const chatTokenBudget = resolveChatTokenBudget(kindPresets.chat.model);

const defaults: ProviderValues = {
  name: "",
  provider_kind: "chat",
  model: kindPresets.chat.model,
  base_url: kindPresets.chat.base_url,
  api_key: "",
  extra_body: kindPresets.chat.extra_body,
  context_window: chatTokenBudget.context_window,
  max_output_tokens: chatTokenBudget.max_output_tokens,
  supports_image_input: false,
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

function resolveIsDefault(
  providerKind: ProviderKind,
  isDefault: boolean,
): boolean {
  return providerKind === "chat" && isDefault;
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
    fetchModelProviders({ skipErrorNotify: true })
      .then(setProviders)
      .catch((e) => setError(getErrorMessage(e)))
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
      provider_kind: provider.provider_kind ?? "chat",
      model: provider.model,
      base_url: provider.base_url,
      api_key: "",
      extra_body: stringifyExtraBody(provider.extra_body ?? {}),
      context_window: provider.context_window,
      max_output_tokens: provider.max_output_tokens,
      supports_image_input: provider.supports_image_input ?? false,
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
          provider_kind: values.provider_kind,
          model: values.model,
          base_url: values.base_url,
          extra_body,
          context_window: values.context_window,
          max_output_tokens: values.max_output_tokens,
          supports_image_input: values.supports_image_input,
          is_default: resolveIsDefault(values.provider_kind, values.is_default),
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
          provider_kind: values.provider_kind,
          model: values.model,
          base_url: values.base_url,
          api_key: values.api_key.trim(),
          extra_body,
          context_window: values.context_window,
          max_output_tokens: values.max_output_tokens,
          supports_image_input: values.supports_image_input,
          is_default: resolveIsDefault(values.provider_kind, values.is_default),
          is_enabled: values.is_enabled,
        };
        await createModelProvider(payload);
        toast.success("模型已创建");
        setCreateOpen(false);
      }
      form.reset(defaults);
      load();
    } catch {}
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
    } catch {}
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
    } catch {
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
            配置 OpenAI 兼容 Provider：对话（DeepSeek / OpenAI）、图片（火山
            Seedream）、视频（火山 Seedance）。API Key 在 admin 内加密存储；
            仅「对话」类型可作 chat 默认模型。
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
                  <TableHead>类型</TableHead>
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
                    <TableCell>
                      <Badge variant="outline">
                        {kindLabels[provider.provider_kind ?? "chat"]}
                      </Badge>
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
                      {!provider.is_default &&
                        provider.is_enabled &&
                        (provider.provider_kind ?? "chat") === "chat" && (
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
          <DialogBody>
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
                        {(testResult.provider.provider_kind ?? "chat") ===
                        "chat"
                          ? "首条回复："
                          : (testResult.provider.provider_kind ?? "chat") ===
                              "image"
                            ? "结果 URL："
                            : "验证结果："}
                        {(testResult.provider.provider_kind ?? "chat") !==
                          "chat" &&
                        /^https?:\/\//.test(testResult.result.sample) ? (
                          <a
                            href={testResult.result.sample}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-1 font-mono text-xs text-primary underline"
                          >
                            {testResult.result.sample}
                          </a>
                        ) : (
                          <code className="rounded bg-muted px-1 py-0.5">
                            {testResult.result.sample}
                          </code>
                        )}
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
          </DialogBody>
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
  const providerKind = form.watch("provider_kind");

  function applyKindPreset(kind: ProviderKind) {
    const preset = kindPresets[kind];
    form.setValue("base_url", preset.base_url);
    form.setValue("model", preset.model);
    form.setValue("extra_body", preset.extra_body);
    if (kind === "chat") {
      const budget = resolveChatTokenBudget(preset.model);
      form.setValue("context_window", budget.context_window);
      form.setValue("max_output_tokens", budget.max_output_tokens);
    } else {
      form.setValue("is_default", false);
    }
  }

  function applyChatTokenBudgetForModel(model: string) {
    if (providerKind !== "chat") return;
    const budget = resolveChatTokenBudget(model);
    form.setValue("context_window", budget.context_window);
    form.setValue("max_output_tokens", budget.max_output_tokens);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            base_url 为 API 前缀（火山 Ark：
            https://ark.cn-beijing.volces.com/api/v3）。图片测试会实际生成图片并可能计费；
            视频测试只验证 Ark API 鉴权，不创建生成任务。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Form {...form}>
            <form id="provider-form" onSubmit={form.handleSubmit(onSubmit)}>
              <FieldGroup>
                <FormField
                  control={form.control}
                  name="provider_kind"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel>类型</FieldLabel>
                      <Select
                        value={field.value}
                        onValueChange={(value: ProviderKind) => {
                          field.onChange(value);
                          if (value !== "chat") {
                            form.setValue("is_default", false);
                          }
                          if (!isEditing) applyKindPreset(value);
                        }}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="选择 Provider 类型" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="chat">对话 (chat)</SelectItem>
                          <SelectItem value="image">
                            图片生成 (Seedream)
                          </SelectItem>
                          <SelectItem value="video">
                            视频生成 (Seedance)
                          </SelectItem>
                          <SelectItem value="embedding">
                            向量嵌入 (Embedding · RAG)
                          </SelectItem>
                          <SelectItem value="rerank">
                            重排 (Rerank · RAG)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <FieldError
                        errors={[form.formState.errors.provider_kind]}
                      />
                    </Field>
                  )}
                />
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
                          onBlur={(event) => {
                            field.onBlur();
                            if (!isEditing)
                              applyChatTokenBudgetForModel(event.target.value);
                          }}
                          placeholder={
                            providerKind === "image"
                              ? "doubao-seedream-5-0-260128"
                              : providerKind === "video"
                                ? "doubao-seedance-2-0-260128"
                                : "deepseek-v4-pro-260425 / glm-5-2-260617 / doubao-seed-2-1-pro-260628"
                          }
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
                          placeholder={
                            providerKind === "chat"
                              ? "https://api.deepseek.com"
                              : ARK_BASE_URL
                          }
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
                          rows={providerKind === "video" ? 8 : 4}
                          className="font-mono text-xs"
                          placeholder={kindPresets[providerKind].extra_body}
                        />
                      </FormControl>
                      {providerKind === "video" ? (
                        <Muted className="text-xs">
                          视频输出：ratio（16:9 / 9:16 / 1:1
                          等）、resolution（480p / 720p /
                          1080p）、generate_audio、watermark、framespersecond（24
                          / 25 / 30 / 60）；同时影响 Ark 生成与拼接规格。
                        </Muted>
                      ) : null}
                      <FieldError errors={[form.formState.errors.extra_body]} />
                    </Field>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="context_window"
                    render={({ field }) => (
                      <Field>
                        <FieldLabel>Context window</FieldLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min={1024}
                            max={2_000_000}
                            onChange={(event) =>
                              field.onChange(event.currentTarget.valueAsNumber)
                            }
                          />
                        </FormControl>
                        <FieldError
                          errors={[form.formState.errors.context_window]}
                        />
                      </Field>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="max_output_tokens"
                    render={({ field }) => (
                      <Field>
                        <FieldLabel>Max output tokens</FieldLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min={256}
                            max={1_000_000}
                            onChange={(event) =>
                              field.onChange(event.currentTarget.valueAsNumber)
                            }
                          />
                        </FormControl>
                        <FieldError
                          errors={[form.formState.errors.max_output_tokens]}
                        />
                      </Field>
                    )}
                  />
                </div>
                {providerKind === "chat" && (
                  <FormField
                    control={form.control}
                    name="supports_image_input"
                    render={({ field }) => (
                      <Field>
                        <FieldLabel className="flex items-center gap-2">
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                          />
                          支持图片输入（多模态视觉）
                          <span className="text-xs font-normal text-muted-foreground">
                            关闭时上传图片自动降级为文本引用
                          </span>
                        </FieldLabel>
                      </Field>
                    )}
                  />
                )}
                {providerKind === "chat" && (
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
                          设为默认对话模型
                        </FieldLabel>
                        <FieldError
                          errors={[form.formState.errors.is_default]}
                        />
                      </Field>
                    )}
                  />
                )}
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
            </form>
          </Form>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="submit"
            form="provider-form"
            disabled={form.formState.isSubmitting}
          >
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
