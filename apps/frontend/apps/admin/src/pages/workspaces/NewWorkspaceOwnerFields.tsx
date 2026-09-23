import { Field, FieldError, FieldLabel, Input } from "@repo/design-system";
import { Controller, type UseFormReturn } from "react-hook-form";

import type { CreateWorkspaceValues } from "./CreateWorkspaceDialog";

const fields = [
  ["ownerAccount", "负责人账号", "text"],
  ["ownerPassword", "负责人密码", "password"],
  ["ownerEmail", "负责人邮箱", "email"],
  ["ownerDisplayName", "负责人昵称（可选）", "text"],
] as const;

export function NewWorkspaceOwnerFields({ form }: { form: UseFormReturn<CreateWorkspaceValues> }) {
  return fields.map(([name, label, type]) => (
    <Controller
      key={name}
      control={form.control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{label}</FieldLabel>
          <Input id={field.name} aria-invalid={fieldState.invalid} type={type} {...field} />
          <FieldError errors={[form.formState.errors[name]]} />
        </Field>
      )}
    />
  ));
}
