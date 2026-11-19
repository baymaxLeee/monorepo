import { zodResolver } from "@hookform/resolvers/zod";
import { type AgentPluginListItem } from "@repo/api/admin";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@repo/design-system";
import { Controller, type FieldPath, type FieldValues, type UseFormReturn, useForm } from "react-hook-form";
import { z } from "zod";

function isJsonObject(raw: string) {
  try {
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === "object" && !Array.isArray(value);
  } catch {
    return false;
  }
}

function isStringRecord(raw: string) {
  try {
    return z.record(z.string(), z.string()).safeParse(JSON.parse(raw)).success;
  } catch {
    return false;
  }
}

const jsonObject = z.string().refine(isJsonObject, "请输入合法 JSON 对象");
const jsonStringRecord = z.string().refine(isStringRecord, "请输入 value 均为字符串的 JSON 对象");

export const publishSchema = z.object({
  manifest: jsonObject,
  installPolicy: z.enum(["available", "installed-by-default", "not-available"]),
  availability: z.enum(["available", "unavailable"]),
  listed: z.boolean(),
});

export const installSchema = z.object({
  releaseDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/, "Release digest 无效"),
  enabled: z.boolean(),
  config: jsonStringRecord,
  secrets: jsonStringRecord,
});

export type PublishValues = z.infer<typeof publishSchema>;
export type InstallValues = z.infer<typeof installSchema>;

export const manifestTemplate = JSON.stringify(
  {
    schemaVersion: 1,
    id: "example@external",
    version: "1.0.0",
    displayName: "Example MCP",
    description: "Example external MCP plugin.",
    source: "external-mcp",
    trust: "unverified",
    mcpServers: [
      {
        name: "example",
        url: "https://example.com/mcp",
        secretHeaders: { Authorization: "access_token" },
        tools: [
          {
            name: "example_read",
            description: "Read from the external service.",
            inputSchema: { type: "object", properties: {}, additionalProperties: false },
            policy: { capability: "external", effect: "read", trust: "open-world", execution: "inline" },
            planning: { summary: "Read from the external service." },
          },
        ],
      },
    ],
  },
  null,
  2,
);

export function usePublishPluginForm() {
  return useForm<PublishValues>({
    resolver: zodResolver(publishSchema),
    defaultValues: {
      manifest: manifestTemplate,
      installPolicy: "available",
      availability: "available",
      listed: true,
    },
  });
}

export function useInstallPluginForm() {
  return useForm<InstallValues>({
    resolver: zodResolver(installSchema),
    defaultValues: { releaseDigest: "", enabled: true, config: "{}", secrets: "{}" },
  });
}

function JsonField<TValues extends FieldValues>({
  form,
  label,
  name,
  rows = 5,
}: {
  form: UseFormReturn<TValues>;
  label: string;
  name: FieldPath<TValues>;
  rows?: number;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Textarea
            {...field}
            id={field.name}
            aria-invalid={fieldState.invalid}
            className="font-mono text-xs"
            rows={rows}
            value={typeof field.value === "string" ? field.value : ""}
          />
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

export function PublishDialog({
  form,
  onOpenChange,
  onSubmit,
  open,
}: {
  form: UseFormReturn<PublishValues>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: PublishValues) => Promise<void>;
  open: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>发布插件 Release</DialogTitle>
          <DialogDescription>
            Manifest 固定 MCP URL、tool inventory/schema 与 policy；Admin 不连接端点。发布后 digest 不可变。
          </DialogDescription>
        </DialogHeader>
        <form id="publish-plugin-form" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <JsonField form={form} name="manifest" label="Manifest JSON" rows={16} />
            <Controller
              control={form.control}
              name="installPolicy"
              render={({ field }) => (
                <Field>
                  <FieldLabel>安装策略</FieldLabel>
                  <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="available">可安装</SelectItem>
                      <SelectItem value="installed-by-default">默认安装</SelectItem>
                      <SelectItem value="not-available">不可安装</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="availability"
              render={({ field }) => (
                <Field>
                  <FieldLabel>可用状态</FieldLabel>
                  <Select name={field.name} value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="available">可用</SelectItem>
                      <SelectItem value="unavailable">不可用</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
            <Controller
              control={form.control}
              name="listed"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <div className="flex-1">
                    <FieldLabel htmlFor={field.name}>在插件资源列表展示</FieldLabel>
                    <FieldDescription>关闭后已有安装仍保留，但工作空间不能从 catalog 新安装。</FieldDescription>
                  </div>
                  <Switch id={field.name} name={field.name} checked={field.value} onCheckedChange={field.onChange} />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
            取消
          </Button>
          <Button type="submit" form="publish-plugin-form" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "发布中…" : "发布不可变 Release"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function InstallDialog({
  form,
  onOpenChange,
  onSubmit,
  plugin,
}: {
  form: UseFormReturn<InstallValues>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: InstallValues) => Promise<void>;
  plugin: AgentPluginListItem | null;
}) {
  return (
    <Dialog open={Boolean(plugin)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>安装 {plugin?.displayName}</DialogTitle>
          <DialogDescription>
            配置与 token 只用于生成 Turn 级 connection grant；token 加密存储且不会在列表中回显。
          </DialogDescription>
        </DialogHeader>
        <form id="install-plugin-form" onSubmit={form.handleSubmit(onSubmit)}>
          <FieldGroup>
            <Controller
              control={form.control}
              name="releaseDigest"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Release digest</FieldLabel>
                  <Input {...field} id={field.name} className="font-mono text-xs" />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <JsonField form={form} name="config" label="非秘密配置 JSON" />
            <JsonField form={form} name="secrets" label="秘密配置 JSON（例如 access_token）" />
            <Controller
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <Field orientation="horizontal">
                  <FieldLabel htmlFor={field.name}>安装后启用</FieldLabel>
                  <Switch id={field.name} name={field.name} checked={field.value} onCheckedChange={field.onChange} />
                </Field>
              )}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={form.formState.isSubmitting}>
            取消
          </Button>
          <Button type="submit" form="install-plugin-form" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? "保存中…" : "保存安装"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
