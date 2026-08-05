import { zodResolver } from "@hookform/resolvers/zod";
import { type CreateOrgInput, createOrg } from "@repo/api";
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

import { NewOrganizationOwnerFields } from "./NewOrganizationOwnerFields";

const createOrgSchema = z.object({
  name: z.string().trim().min(1, "请输入组织名称").max(100),
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

export type CreateOrgValues = z.infer<typeof createOrgSchema>;

const defaults: CreateOrgValues = {
  name: "",
  slug: "",
  ownerMode: "new",
  ownerUserId: "",
  ownerAccount: "",
  ownerPassword: "",
  ownerEmail: "",
  ownerDisplayName: "",
};

export function CreateOrganizationDialog({
  onDone,
  onOpenChange,
  open,
}: {
  onDone: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const form = useForm<CreateOrgValues>({
    resolver: zodResolver(createOrgSchema as never),
    defaultValues: defaults,
  });
  const ownerMode = form.watch("ownerMode");

  async function submit(values: CreateOrgValues) {
    let payload: CreateOrgInput;
    if (values.ownerMode === "existing") {
      if (!values.ownerUserId?.trim()) {
        form.setError("ownerUserId", { message: "请填写负责人用户 ID" });
        return;
      }
      payload = {
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
        name: values.name,
        slug: values.slug,
        ownerAccount: values.ownerAccount.trim(),
        ownerPassword: values.ownerPassword,
        ownerEmail: values.ownerEmail.trim(),
        ownerDisplayName: values.ownerDisplayName?.trim() || undefined,
      };
    }
    try {
      await createOrg(payload);
      toast.success("组织已创建");
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
          <DialogTitle>新建组织</DialogTitle>
          <DialogDescription>每个组织都必须有一个负责人（org_admin）。</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Form {...form}>
            <form id="organization-form" onSubmit={form.handleSubmit(submit)}>
              <FieldGroup>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <Field>
                      <FieldLabel>组织名称</FieldLabel>
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
                      <Select value={field.value} onValueChange={field.onChange}>
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
                  <NewOrganizationOwnerFields form={form} />
                )}
              </FieldGroup>
            </form>
          </Form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button type="submit" form="organization-form" disabled={form.formState.isSubmitting}>
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
