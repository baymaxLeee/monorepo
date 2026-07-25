import { Field, FieldError, FieldLabel, FormControl, FormField, Input } from "components";
import type { UseFormReturn } from "react-hook-form";

import type { CreateOrgValues } from "./CreateOrganizationDialog";

const fields = [
  ["ownerAccount", "负责人账号", "text"],
  ["ownerPassword", "负责人密码", "password"],
  ["ownerEmail", "负责人邮箱", "email"],
  ["ownerDisplayName", "负责人昵称（可选）", "text"],
] as const;

export function NewOrganizationOwnerFields({ form }: { form: UseFormReturn<CreateOrgValues> }) {
  return fields.map(([name, label, type]) => (
    <FormField
      key={name}
      control={form.control}
      name={name}
      render={({ field }) => (
        <Field>
          <FieldLabel>{label}</FieldLabel>
          <FormControl>
            <Input type={type} {...field} />
          </FormControl>
          <FieldError errors={[form.formState.errors[name]]} />
        </Field>
      )}
    />
  ));
}
