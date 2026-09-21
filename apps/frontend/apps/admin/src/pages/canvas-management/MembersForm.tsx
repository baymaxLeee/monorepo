import { canvasUpdateProjectMembers, type CanvasProjectManagement, type WorkspaceMemberView } from "@repo/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toast,
} from "@repo/design-system";
import { useForm } from "react-hook-form";

export function MembersForm({
  details,
  directory,
  editable,
  onSaved,
}: {
  details: CanvasProjectManagement;
  directory: WorkspaceMemberView[];
  editable: boolean;
  onSaved: (value: CanvasProjectManagement) => void;
}) {
  const candidates = [
    ...directory.map((member) => ({ id: member.userId, name: member.displayName || member.account })),
    ...details.members
      .filter((member) => !directory.some((entry) => entry.userId === member.user_id))
      .map((member) => ({ id: member.user_id, name: member.user_id })),
  ];
  const form = useForm({
    defaultValues: {
      roles: candidates.map((member) => ({
        user_id: member.id,
        role: details.members.find((entry) => entry.user_id === member.id)?.role ?? "none",
      })),
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>项目成员</CardTitle>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit(async (values) => {
              try {
                const next = await canvasUpdateProjectMembers(details.project.id, {
                  expected_revision: details.project.revision,
                  members: values.roles.filter((member) => member.role !== "none"),
                });
                onSaved(next);
                toast.success("项目成员已保存");
              } catch {
                /* Keep the form available for correction. */
              }
            })}
          >
            <p className="text-sm text-muted-foreground">
              编辑者可修改画布，查看者仅可读取。创建者权限固定，工作空间管理员可管理所有项目。
            </p>
            {candidates.map((member, index) => (
              <FormField
                key={member.id}
                control={form.control}
                name={`roles.${index}.role`}
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-4">
                    <FormLabel>{member.name}</FormLabel>
                    <Select
                      value={field.value}
                      disabled={!editable || member.id === details.project.created_by || form.formState.isSubmitting}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {member.id === details.project.created_by ? (
                          <SelectItem value="owner">创建者</SelectItem>
                        ) : (
                          <>
                            <SelectItem value="none">不在项目中</SelectItem>
                            <SelectItem value="editor">编辑者</SelectItem>
                            <SelectItem value="viewer">查看者</SelectItem>
                          </>
                        )}
                      </SelectContent>
                    </Select>
                  </FormItem>
                )}
              />
            ))}
            {editable ? (
              <Button type="submit" disabled={form.formState.isSubmitting}>
                保存成员
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">仅工作空间管理员可以调整项目成员。</p>
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
