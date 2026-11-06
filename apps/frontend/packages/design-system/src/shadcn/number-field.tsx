import { NumberField as NumberFieldPrimitive } from "@base-ui/react/number-field";
import { buttonVariants } from "@repo/design-system/shadcn/button";
import { cn } from "@repo/shared";
import { MinusIcon, PlusIcon } from "lucide-react";

export const NumberField = NumberFieldPrimitive.Root;
export function NumberFieldGroup({ className, ...props }: NumberFieldPrimitive.Group.Props) {
  return (
    <NumberFieldPrimitive.Group
      className={cn(
        "flex w-full items-center rounded-lg border border-input bg-background focus-within:ring-3 focus-within:ring-ring/50",
        className,
      )}
      {...props}
    />
  );
}
export function NumberFieldInput({ className, ...props }: NumberFieldPrimitive.Input.Props) {
  return (
    <NumberFieldPrimitive.Input
      data-slot="number-field-input"
      className={cn(
        "h-8 w-full min-w-0 bg-transparent px-2 text-center text-base outline-none tabular-nums md:text-sm disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
export function NumberFieldDecrement({ className, children, ...props }: NumberFieldPrimitive.Decrement.Props) {
  return (
    <NumberFieldPrimitive.Decrement
      aria-label="减少"
      data-slot="button"
      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), className)}
      {...props}
    >
      {children ?? <MinusIcon />}
    </NumberFieldPrimitive.Decrement>
  );
}
export function NumberFieldIncrement({ className, children, ...props }: NumberFieldPrimitive.Increment.Props) {
  return (
    <NumberFieldPrimitive.Increment
      aria-label="增加"
      data-slot="button"
      className={cn(buttonVariants({ variant: "ghost", size: "icon" }), className)}
      {...props}
    >
      {children ?? <PlusIcon />}
    </NumberFieldPrimitive.Increment>
  );
}
export function NumberInput({
  inputProps,
  ...props
}: NumberFieldPrimitive.Root.Props & { inputProps?: NumberFieldPrimitive.Input.Props }) {
  return (
    <NumberField {...props}>
      <NumberFieldGroup>
        <NumberFieldDecrement />
        <NumberFieldInput {...inputProps} />
        <NumberFieldIncrement />
      </NumberFieldGroup>
    </NumberField>
  );
}
