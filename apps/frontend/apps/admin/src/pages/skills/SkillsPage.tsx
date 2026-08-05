import { zodResolver } from "@hookform/resolvers/zod";
import { createSkill, deleteSkill, fetchSkills, type SkillSummary } from "@repo/api";
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
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
  toast,
} from "@repo/design-system";
import { getErrorMessage } from "@repo/shared";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请输入名称")
    .max(64)
    .regex(/^[a-z](?:[a-z0-9]|-(?=[a-z0-9]))*[a-z0-9]$|^[a-z]$/, "请使用 kebab-case"),
  description: z.string().trim().min(1, "请输入使用场景").max(1024),
});

type Values = z.infer<typeof schema>;

function SkillState({ skill }: { skill: SkillSummary }) {
  if (skill.status !== "published") {
    return <Badge variant="secondary">草稿</Badge>;
  }
  return (
    <div className="flex gap-2">
      <Badge>已发布</Badge>
      {skill.has_unpublished_changes && <Badge variant="secondary">有未发布修改</Badge>}
    </div>
  );
}

export function SkillsPage() {
  const navigate = useNavigate();
  const [skills, setSkills] = useState<SkillSummary[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", description: "" },
  });

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    fetchSkills({ skipErrorNotify: true })
      .then(setSkills)
      .catch((reason: unknown) => setError(getErrorMessage(reason)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function create(values: Values) {
    const skill = await createSkill(values);
    toast.success("技能工作区已创建");
    setCreateOpen(false);
    form.reset();
    navigate(skill.id);
  }

  async function remove(skill: SkillSummary) {
    if (!window.confirm(`确认删除「${skill.name}」及其文件树？`)) {
      return;
    }
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
            Skill 是包含 SKILL.md、参考资料、模板和脚本的文件工作区；发布后才会被智能体使用。
          </PageDescription>
        </PageHeaderContent>
        <PageActions>
          <Button variant="outline" onClick={load} disabled={loading}>
            刷新
          </Button>
          <Button onClick={() => setCreateOpen(true)}>新建技能</Button>
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
          <CardDescription>{skills ? `共 ${skills.length} 条` : "加载中…"}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : skills?.length ? (
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
                    <TableCell className="font-mono text-xs">{skill.name}</TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">{skill.description}</TableCell>
                    <TableCell>
                      <SkillState skill={skill} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(skill.updated_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="link" size="sm" onClick={() => navigate(skill.id)}>
                        打开
                      </Button>
                      <Button variant="link" size="sm" onClick={() => void remove(skill)}>
                        删除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Muted>暂无技能。</Muted>
          )}
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>新建技能</DialogTitle>
            <DialogDescription>创建后进入文件工作区，系统会生成标准 SKILL.md。</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Form {...form}>
              <form id="create-skill" onSubmit={form.handleSubmit(create)}>
                <FieldGroup>
                  <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                      <Field>
                        <FieldLabel>名称</FieldLabel>
                        <FormControl>
                          <Input placeholder="product-launch" {...field} />
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
                        <FieldLabel>描述（做什么、何时使用）</FieldLabel>
                        <FormControl>
                          <Textarea rows={3} {...field} />
                        </FormControl>
                        <FieldError errors={[form.formState.errors.description]} />
                      </Field>
                    )}
                  />
                </FieldGroup>
              </form>
            </Form>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button type="submit" form="create-skill" disabled={form.formState.isSubmitting}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
