import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar";
import { buttonVariants } from "@repo/design-system/shadcn/button";
import { cn } from "@repo/shared";
import type { VariantProps } from "class-variance-authority";

export function Toolbar({ className, ...props }: ToolbarPrimitive.Root.Props) {
  return <ToolbarPrimitive.Root data-slot="toolbar" className={cn("flex items-center gap-1", className)} {...props} />;
}
export function ToolbarButton({
  className,
  variant = "ghost",
  size = "icon",
  ...props
}: ToolbarPrimitive.Button.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ToolbarPrimitive.Button
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
export function ToolbarGroup({ className, ...props }: ToolbarPrimitive.Group.Props) {
  return <ToolbarPrimitive.Group className={cn("flex items-center gap-1", className)} {...props} />;
}
export function ToolbarSeparator({ className, ...props }: ToolbarPrimitive.Separator.Props) {
  return <ToolbarPrimitive.Separator className={cn("mx-1 h-4 w-px bg-border", className)} {...props} />;
}
export const ToolbarLink = ToolbarPrimitive.Link;
export const ToolbarInput = ToolbarPrimitive.Input;
