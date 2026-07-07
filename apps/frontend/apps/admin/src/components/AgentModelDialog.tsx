import { zodResolver } from "@hookform/resolvers/zod";
import {
  type Bot,
  type BotStatus,
  type BotTone,
  type ModelProvider,
  updateBot,
} from "api";
import {
  Button,
  Dialog,
  DialogBody,
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
  Form,
  FormControl,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  toast,
} from "components";
import { useEffect } from "react";
import { type Control, useForm } from "react-hook-form";
import { z } from "zod";
import { BotSkillsPanel } from "./BotSkillsPanel";

const NONE = "__none__";

const TONE_OPTIONS: { value: BotTone; label: string }[] = [
  { value: "professional", label: "专业严谨" },
  { value: "concise", label: "简洁直接" },
  { value: "friendly", label: "亲切友好" },
  { value: "empathetic", label: "共情耐心" },
];

const STATUS_OPTIONS: { value: BotStatus; label: string }[] = [
  { value: "draft", label: "草稿" },
  { value: "published", label: "已发布" },
  { value: "archived", label: "已归档" },
];

const schema = z.object({
  name: z.string().trim().min(1, "请输入名称"),
  status: z.enum(["draft", "published", "archived"]),
  role_description: z.string().max(2000, "最多 2000 字"),
  domain_description: z.string().max(2000, "最多 2000 字"),
  audience: z.string().max(200, "最多 200 字"),
  tone: z.enum(["professional", "concise", "friendly", "empathetic"]),
  welcome_message: z.string().max(1000, "最多 1000 字"),
  suggested_questions: z.string(),
  text_provider_id: z.string(),
  image_provider_id: z.string(),
  video_provider_id: z.string(),
});
type Values = z.infer<typeof schema>;

const toId = (value: string): string | null => (value === NONE ? null : value);
const fromId = (value: string | null): string => value ?? NONE;

// suggested_questions is a string[] on the wire but edited as one-per-line text.
const questionsToText = (items: string[]): string => items.join("\n");
const textToQuestions = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);

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
      status: "draft",
      role_description: "",
      domain_description: "",
      audience: "",
      tone: "professional",
      welcome_message: "",
      suggested_questions: "",
      text_provider_id: NONE,
      image_provider_id: NONE,
      video_provider_id: NONE,
    },
  });

  useEffect(() => {
    if (!bot) return;
    form.reset({
      name: bot.name,
      status: bot.status ?? "draft",
      role_description: bot.role_description ?? "",
      domain_description: bot.domain_description ?? "",
      audience: bot.audience ?? "",
      tone: bot.tone ?? "professional",
      welcome_message: bot.welcome_message ?? "",
      suggested_questions: questionsToText(bot.suggested_questions ?? []),
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
        status: values.status,
        role_description: values.role_description.trim() || null,
        domain_description: values.domain_description.trim() || null,
        audience: values.audience.trim() || null,
        tone: values.tone,
        welcome_message: values.welcome_message.trim() || null,
        suggested_questions: textToQuestions(values.suggested_questions),
        text_provider_id: toId(values.text_provider_id),
        image_provider_id: toId(values.image_provider_id),
        video_provider_id: toId(values.video_provider_id),
      });
      toast.success("配置已保存");
      onOpenChange(false);
      onSaved();
    } catch {}
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>配置智能体</DialogTitle>
          <DialogDescription>
            分「身份 / 模型 / 技能 /
            展示」四组配置。身份进入模型上下文，模型决定可用能力，技能可在对话中通过
            / 唤起，展示项仅用于前端。
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="identity" className="min-h-0 flex-1 gap-3">
          <TabsList className="w-full">
            <TabsTrigger value="identity">身份</TabsTrigger>
            <TabsTrigger value="models">模型</TabsTrigger>
            <TabsTrigger value="skills">技能</TabsTrigger>
            <TabsTrigger value="presentation">展示</TabsTrigger>
          </TabsList>
          <DialogBody>
            <Form {...form}>
              <form
                id="agent-model-form"
                onSubmit={form.handleSubmit(onSubmit)}
              >
                <TabsContent value="identity" className="mt-0">
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
                      name="status"
                      render={({ field }) => (
                        <Field>
                          <FieldLabel>发布状态</FieldLabel>
                          <FormControl>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUS_OPTIONS.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                          <FieldDescription>
                            仅「已发布」的智能体会对终端用户可见。
                          </FieldDescription>
                        </Field>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="role_description"
                      render={({ field }) => (
                        <Field>
                          <FieldLabel htmlFor="agent-role">角色描述</FieldLabel>
                          <FormControl>
                            <Textarea
                              id="agent-role"
                              rows={4}
                              placeholder="这个智能体扮演什么角色、负责什么、如何作答。例如：团队 Oncall 事故排查助手，按 根因 / 排查 / 验证 / 修复 四段作答。"
                              {...field}
                            />
                          </FormControl>
                          <FieldError
                            errors={[form.formState.errors.role_description]}
                          />
                        </Field>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="domain_description"
                      render={({ field }) => (
                        <Field>
                          <FieldLabel htmlFor="agent-domain">
                            领域范围
                          </FieldLabel>
                          <FormControl>
                            <Textarea
                              id="agent-domain"
                              rows={3}
                              placeholder="这个智能体覆盖的知识领域。例如：团队线上事故排查、SOP、Runbook、架构与配置知识。"
                              {...field}
                            />
                          </FormControl>
                          <FieldError
                            errors={[form.formState.errors.domain_description]}
                          />
                        </Field>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="audience"
                      render={({ field }) => (
                        <Field>
                          <FieldLabel htmlFor="agent-audience">
                            目标受众
                          </FieldLabel>
                          <FormControl>
                            <Input
                              id="agent-audience"
                              placeholder="例如：一线值班与运维工程师"
                              {...field}
                            />
                          </FormControl>
                          <FieldError
                            errors={[form.formState.errors.audience]}
                          />
                        </Field>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="tone"
                      render={({ field }) => (
                        <Field>
                          <FieldLabel>语气</FieldLabel>
                          <FormControl>
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {TONE_OPTIONS.map((option) => (
                                  <SelectItem
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </FormControl>
                        </Field>
                      )}
                    />
                  </FieldGroup>
                </TabsContent>

                <TabsContent value="models" className="mt-0">
                  <FieldGroup>
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
                    <FieldDescription>
                      模型留空表示不启用该能力。仅列出已启用的 provider。
                    </FieldDescription>
                  </FieldGroup>
                </TabsContent>

                <TabsContent value="presentation" className="mt-0">
                  <FieldGroup>
                    <FormField
                      control={form.control}
                      name="welcome_message"
                      render={({ field }) => (
                        <Field>
                          <FieldLabel htmlFor="agent-welcome">
                            欢迎语
                          </FieldLabel>
                          <FormControl>
                            <Textarea
                              id="agent-welcome"
                              rows={2}
                              placeholder="用户进入对话时看到的开场白。"
                              {...field}
                            />
                          </FormControl>
                          <FieldError
                            errors={[form.formState.errors.welcome_message]}
                          />
                        </Field>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="suggested_questions"
                      render={({ field }) => (
                        <Field>
                          <FieldLabel htmlFor="agent-questions">
                            推荐问题
                          </FieldLabel>
                          <FormControl>
                            <Textarea
                              id="agent-questions"
                              rows={4}
                              placeholder={
                                "服务 5xx 突然升高，如何快速定位根因？\n数据库连接池被打满，怎么一步步排查？"
                              }
                              {...field}
                            />
                          </FormControl>
                          <FieldDescription>
                            每行一条，最多 6
                            条。欢迎语与推荐问题仅用于前端展示。
                          </FieldDescription>
                        </Field>
                      )}
                    />
                  </FieldGroup>
                </TabsContent>
              </form>
            </Form>

            <TabsContent value="skills" className="mt-0">
              {bot ? (
                <BotSkillsPanel botId={bot.id} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  请先保存智能体后再配置技能。
                </p>
              )}
            </TabsContent>
          </DialogBody>
        </Tabs>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            关闭
          </Button>
          <Button
            type="submit"
            form="agent-model-form"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
