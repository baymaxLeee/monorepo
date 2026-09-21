import { zodResolver } from "@hookform/resolvers/zod";
import { createTenant, listTenants, type Tenant } from "@repo/api";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Field,
  FieldLabel,
  FieldError,
  Input,
  Form,
  FormField,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

const schema = z.object({
  name: z.string().trim().min(1, "请输入公司名称").max(120),
  slug: z
    .string()
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "仅限小写字母、数字和连字符")
    .max(64),
});

export function TenantField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [open, setOpen] = useState(false);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", slug: "" },
  });
  useEffect(() => {
    void listTenants()
      .then(setTenants)
      .catch(() => {});
  }, []);
  async function submit(input: z.infer<typeof schema>) {
    try {
      const tenant = await createTenant(input);
      setTenants((current) => [...current, tenant]);
      onChange(tenant.id);
      setOpen(false);
      form.reset();
    } catch {}
  }
  return (
    <>
      <div className="flex gap-2">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="选择公司" />
          </SelectTrigger>
          <SelectContent>
            {tenants.map((tenant) => (
              <SelectItem key={tenant.id} value={tenant.id}>
                {tenant.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          新建公司
        </Button>
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建公司</DialogTitle>
          </DialogHeader>
          <Form {...form}>
            <div className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <Field>
                    <FieldLabel>公司名称</FieldLabel>
                    <Input {...field} />
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
                    <Input {...field} />
                    <FieldError errors={[form.formState.errors.slug]} />
                  </Field>
                )}
              />
            </div>
          </Form>
          <DialogFooter>
            <Button type="button" disabled={form.formState.isSubmitting} onClick={form.handleSubmit(submit)}>
              创建
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
