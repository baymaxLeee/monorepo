import { zodResolver } from "@hookform/resolvers/zod";
import { type Bot, type ModelProvider, updateBot } from "api";
import {
  Button,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  toast,
} from "components";
import { useEffect } from "react";
import { type Control, useForm } from "react-hook-form";
import { z } from "zod";

const NONE = "__none__";

const schema = z.object({
  name: z.string().trim().min(1, "请输入名称"),
  system_prompt: z.string(),
  text_provider_id: z.string(),
  image_provider_id: z.string(),
  video_provider_id: z.string(),
});
type Values = z.infer<typeof schema>;

const toId = (value: string): string | null => (value === NONE ? null : value);
const fromId = (value: string | null): string => value ?? NONE;

function ModelField({
  control,
  name,
  label,
  options,
}: {
  control: Control<Values>;
  name: "text_provider_id" | "image_provider_id" | "video_provider_id";
  label: string;
  options: ModelProvider[];
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <Field>
          <FieldLabel>{label}</FieldLabel>
          <FormControl>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger>
                <SelectValue placeholder="未设置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>未设置</SelectItem>
                {options.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    {provider.name}（{provider.model}）
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormControl>
        </Field>
      )}
    />
  );
}

export function AgentModelDialog({
  bot,
  open,
  onOpenChange,
  providers,
  onSaved,
}: {
  bot: Bot | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providers: ModelProvider[];
  onSaved: () => void;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema as never),
    defaultValues: {
      name: "",
      system_prompt: "",
      text_provider_id: NONE,
      image_provider_id: NONE,
      video_provider_id: NONE,
    },
  });

  useEffect(() => {
    if (!bot) return;
    form.reset({
      name: bot.name,
      system_prompt: bot.system_prompt ?? "",
      text_provider_id: fromId(bot.text_provider_id),
      image_provider_id: fromId(bot.image_provider_id),
      video_provider_id: fromId(bot.video_provider_id),
    });
  }, [bot, form]);

  const byKind = (kind: ModelProvider["provider_kind"]) =>
    providers.filter((p) => p.is_enabled && p.provider_kind === kind);

  async function onSubmit(values: Values) {
    if (!bot) return;
    try {
      await updateBot(bot.id, {
        name: values.name.trim(),
        system_prompt: values.system_prompt.trim() || null,
        text_provider_id: toId(values.text_provider_id),
        image_provider_id: toId(values.image_provider_id),
        video_provider_id: toId(values.video_provider_id),
      });
      toast.success("配置已保存");
      onOpenChange(false);
      onSaved();
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>配置智能体</DialogTitle>
          <DialogDescription>
            设置该智能体的人设（系统提示词）与文本 / 图片 / 视频模型
            provider。模型留空表示不启用该能力。
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
                    <FieldLabel htmlFor="agent-name">名称</FieldLabel>
                    <FormControl>
                      <Input id="agent-name" {...field} />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.name]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="system_prompt"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="agent-system-prompt">
                      人设 / 系统提示词
                    </FieldLabel>
                    <FormControl>
                      <Textarea
                        id="agent-system-prompt"
                        rows={8}
                        placeholder="定义该智能体的角色、领域专长与回答格式。例如 oncall 排查助手的四段式（根因 / 排查 / 验证 / 修复建议）。留空则使用通用助手行为。"
                        {...field}
                      />
                    </FormControl>
                  </Field>
                )}
              />
              <ModelField
                control={form.control}
                name="text_provider_id"
                label="文本模型"
                options={byKind("chat")}
              />
              <ModelField
                control={form.control}
                name="image_provider_id"
                label="图片模型"
                options={byKind("image")}
              />
              <ModelField
                control={form.control}
                name="video_provider_id"
                label="视频模型"
                options={byKind("video")}
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
                {form.formState.isSubmitting ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
