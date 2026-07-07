import { zodResolver } from "@hookform/resolvers/zod";
import {
  createSkill,
  deleteSkill,
  fetchSkill,
  fetchSkills,
  type Skill,
  type SkillSummary,
  updateSkill,
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

const skillSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请输入名称")
    .max(64)
    .regex(
      /^[a-z][a-z0-9-]*[a-z0-9]$/,
      "只能小写字母、数字、连字符，以字母开头（如 oncall-rca）",
    ),
  description: z.string().max(1024),
  body: z.string().max(20000),
  status: z.enum(["draft", "active", "disabled"]),
  is_enabled: z.boolean(),
});

type SkillValues = z.infer<typeof skillSchema>;

const defaults: SkillValues = {
  name: "",
  description: "",
  body: "",
  status: "draft",
  is_enabled: true,
};

function statusBadge(item: SkillSummary) {
  if (!item.is_enabled) return <Badge variant="secondary">停用</Badge>;
  const labels = { active: "启用", draft: "草稿", disabled: "停用" };
  return (
    <Badge variant={item.status === "active" ? "default" : "secondary"}>
      {labels[item.status]}
    </Badge>
  );
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [editing, setEditing] = useState<Skill | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const form = useForm<SkillValues>({
    resolver: zodResolver(skillSchema as never),
    defaultValues: defaults,
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchSkills()
      .then(setSkills)
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

  async function openEdit(summary: SkillSummary) {
    setCreateOpen(false);
    try {
      // Body is L2 — fetch the full skill only when actually editing one.
      const skill = await fetchSkill(summary.id);
      setEditing(skill);
      form.reset({
        name: skill.name,
        description: skill.description,
        body: skill.body,
        status: skill.status,
        is_enabled: skill.is_enabled,
      });
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function save(values: SkillValues) {
    try {
      if (editing) {
        await updateSkill(editing.id, values);
        toast.success("技能已更新");
        setEditing(null);
      } else {
        await createSkill(values);
        toast.success("技能已创建");
        setCreateOpen(false);
      }
      form.reset(defaults);
      load();
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function remove(skill: SkillSummary) {
    if (!window.confirm(`确认删除「${skill.name}」？`)) return;
    await deleteSkill(skill.id);
    toast.success("技能已删除");
    load();
  }

  return (
    <Page>
      <PageHeader>
        <PageHeaderContent>
          <PageTitle>技能管理</PageTitle>
          <PageDescription>
            维护可被智能体挂载的技能（SKILL.md）。仅名称与描述进入提示词，正文在命中时按需加载。
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
          <Button onClick={openCreate}>新建技能</Button>
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
          <CardTitle>全部技能</CardTitle>
          <CardDescription>
            {loading
              ? "加载中…"
              : skills
                ? `共 ${skills.length} 条`
                : "暂无数据"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : skills && skills.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>描述</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {skills.map((skill) => (
                  <TableRow key={skill.id}>
                    <TableCell className="font-mono text-xs">
                      {skill.name}
                    </TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">
                      {skill.description}
                    </TableCell>
                    <TableCell>{statusBadge(skill)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(skill.updated_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="space-x-1 text-right">
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => {
                          void openEdit(skill);
                        }}
                      >
                        编辑
                      </Button>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => remove(skill)}
                      >
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Muted>列表为空，可点击「新建技能」添加。</Muted>
          )}
        </CardContent>
      </Card>

      <SkillFormDialog
        open={createOpen || Boolean(editing)}
        title={editing ? "编辑技能" : "新建技能"}
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

function SkillFormDialog({
  form,
  onOpenChange,
  onSubmit,
  open,
  title,
}: {
  form: ReturnType<typeof useForm<SkillValues>>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: SkillValues) => void;
  open: boolean;
  title: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            名称为 kebab-case，同时作为模型调用名；正文写清「何时用 / 怎么做」。
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
                      <Input placeholder="oncall-rca" {...field} />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.name]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>描述（何时使用）</FieldLabel>
                    <FormControl>
                      <Textarea rows={2} {...field} />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.description]} />
                  </Field>
                )}
              />
              <FormField
                control={form.control}
                name="body"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>正文（SKILL.md，命中时加载）</FieldLabel>
                    <FormControl>
                      <Textarea
                        rows={10}
                        className="font-mono text-xs"
                        {...field}
                      />
                    </FormControl>
                    <FieldError errors={[form.formState.errors.body]} />
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
