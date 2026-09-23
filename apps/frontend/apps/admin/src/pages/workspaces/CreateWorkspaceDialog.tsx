import { zodResolver } from "@hookform/resolvers/zod";
import { type CreateWorkspaceInput, createWorkspace } from "@repo/api";
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
  toast,
} from "@repo/design-system";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { NewWorkspaceOwnerFields } from "./NewWorkspaceOwnerFields";
import { TenantField } from "./TenantField";

const createWorkspaceSchema = z.object({
  tenantId: z.string().min(1, "请选择所属公司"),
  name: z.string().trim().min(1, "请输入工作空间名称").max(100),
  slug: z
    .string()
    .trim()
    .min(1, "请输入 slug")
    .max(64)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "slug 仅限小写字母、数字与连字符"),
  ownerMode: z.enum(["existing", "new"]),
  ownerUserId: z.string().trim().optional(),
  ownerAccount: z.string().trim().optional(),
  ownerPassword: z.string().optional(),
  ownerEmail: z.string().optional(),
  ownerDisplayName: z.string().optional(),
});

export type CreateWorkspaceValues = z.infer<typeof createWorkspaceSchema>;

const defaults: CreateWorkspaceValues = {
  tenantId: "",
  name: "",
  slug: "",
  ownerMode: "new",
  ownerUserId: "",
  ownerAccount: "",
  ownerPassword: "",
  ownerEmail: "",
  ownerDisplayName: "",
};

export function CreateWorkspaceDialog({
  onDone,
  onOpenChange,
  open,
}: {
  onDone: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const form = useForm<CreateWorkspaceValues>({
    resolver: zodResolver(createWorkspaceSchema as never),
    defaultValues: defaults,
  });
  const ownerMode = form.watch("ownerMode");

  async function submit(values: CreateWorkspaceValues) {
    let payload: CreateWorkspaceInput;
    if (values.ownerMode === "existing") {
      if (!values.ownerUserId?.trim()) {
        form.setError("ownerUserId", { message: "请填写负责人用户 ID" });
        return;
      }
      payload = {
        tenantId: values.tenantId,
        name: values.name,
        slug: values.slug,
        ownerUserId: values.ownerUserId.trim(),
      };
    } else {
      if (!values.ownerAccount?.trim() || !values.ownerPassword || !values.ownerEmail?.trim()) {
        form.setError("ownerAccount", {
          message: "请填写负责人账号、邮箱与密码",
        });
        return;
      }
      payload = {
        tenantId: values.tenantId,
        name: values.name,
        slug: values.slug,
        ownerAccount: values.ownerAccount.trim(),
        ownerPassword: values.ownerPassword,
        ownerEmail: values.ownerEmail.trim(),
        ownerDisplayName: values.ownerDisplayName?.trim() || undefined,
      };
    }
    try {
      await createWorkspace(payload);
      toast.add({ type: "success", title: "工作空间已创建" });
      form.reset(defaults);
      onOpenChange(false);
      onDone();
    } catch {}
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          form.reset(defaults);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建工作空间</DialogTitle>
          <DialogDescription>每个工作空间都必须有一个负责人（workspace_admin）。</DialogDescription>
        </DialogHeader>
        <div>
          <Form {...form}>
            <form id="workspace-form" onSubmit={form.handleSubmit(submit)}>
              <FieldGroup>
                <FormField
                  control={form.control}
                  name="tenantId"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel>所属公司</FieldLabel>
                      <TenantField value={field.value} onChange={field.onChange} />
                      <FieldError errors={[form.formState.errors.tenantId]} />
                    </Field>
                  )}
                />
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel>工作空间名称</FieldLabel>
                      <FormControl>
                        <Input {...field} />
                      </FormControl>
                      <FieldError errors={[form.formState.errors.name]} />
                    </Field>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel>Slug</FieldLabel>
                      <FormControl>
                        <Input placeholder="acme-inc" {...field} />
                      </FormControl>
                      <FieldError errors={[form.formState.errors.slug]} />
                    </Field>
                  )}
                />
                <FormField
                  control={form.control}
                  name="ownerMode"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel>负责人</FieldLabel>
                      <Select value={field.value} onValueChange={(value) => value !== null && field.onChange(value)}>
                        <FormControl>
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="new">新建账号作为负责人</SelectItem>
                          <SelectItem value="existing">使用已有用户 ID</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />
                {ownerMode === "existing" ? (
                  <FormField
                    control={form.control}
                    name="ownerUserId"
                    render={({ field }) => (
                      <Field>
                        <FieldLabel>负责人用户 ID</FieldLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FieldError errors={[form.formState.errors.ownerUserId]} />
                      </Field>
                    )}
                  />
                ) : (
                  <NewWorkspaceOwnerFields form={form} />
                )}
              </FieldGroup>
            </form>
          </Form>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="submit" form="workspace-form" disabled={form.formState.isSubmitting}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
