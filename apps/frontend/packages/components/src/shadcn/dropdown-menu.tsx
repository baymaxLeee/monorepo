import { Check, ChevronRight, Circle } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { createContext, forwardRef, useContext } from "react";
import { cn } from "shared";

import {
  type HoverTriggerHandlers,
  type TriggerKind,
  useHoverTrigger,
} from "../utils/useHoverTrigger";

const DropdownHoverContext = createContext<HoverTriggerHandlers | null>(null);
const useDropdownHoverHandlers = () => useContext(DropdownHoverContext);

export interface DropdownMenuProps
  extends React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root> {
  /** 触发方式，参考 arco `Trigger.trigger`，默认 `"click"`。 */
  trigger?: TriggerKind;
  /** 鼠标进入后延时打开（毫秒），仅 `trigger="hover"` 生效，默认 80。 */
  hoverEnterDelay?: number;
  /** 鼠标移出后延时关闭（毫秒），仅 `trigger="hover"` 生效，默认 200。 */
  hoverCloseDelay?: number;
}

export function DropdownMenu({
  trigger = "click",
  hoverEnterDelay,
  hoverCloseDelay,
  modal,
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...rootProps
}: DropdownMenuProps) {
  const hover = useHoverTrigger({
    trigger,
    open,
    defaultOpen,
    onOpenChange,
    hoverEnterDelay,
    hoverCloseDelay,
  });

  // hover 模式默认 modal=false：Radix DropdownMenu 默认 modal=true 会通过
  // DismissableLayer.disableOutsidePointerEvents 给 trigger 也加上 pointer-events:none，
  // 与 hover 触发互斥（trigger 被禁用 → mouseleave → 关弹层 → 恢复可交互 → mouseenter → 再次打开 → 高频闪烁）。
  // hover 菜单本就是瞬时的，不应该 trap focus / 禁止外部交互，因此 hover 模式默认 false。
  // click 模式保持 Radix 原生默认（true，模态体验）。
  const effectiveModal = modal ?? (hover.enabled ? false : undefined);

  if (!hover.enabled) {
    return (
      <DropdownMenuPrimitive.Root
        modal={effectiveModal}
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        {...rootProps}
      >
        {children}
      </DropdownMenuPrimitive.Root>
    );
  }

  return (
    <DropdownHoverContext.Provider value={hover.handlers}>
      <DropdownMenuPrimitive.Root
        modal={effectiveModal}
        open={hover.open}
        onOpenChange={hover.setOpen}
        {...rootProps}
      >
        {children}
      </DropdownMenuPrimitive.Root>
    </DropdownHoverContext.Provider>
  );
}

export const DropdownMenuGroup = DropdownMenuPrimitive.Group;
export const DropdownMenuPortal = DropdownMenuPrimitive.Portal;
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

// forwardRef：嵌套 `asChild` 时（例如外层 TooltipTrigger 包裹本组件），
// 上层 SlotClone 会向 DropdownMenuTrigger 传 ref，function 组件接不住会触发 React warning。
export const DropdownMenuTrigger = forwardRef<
  React.ComponentRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(function DropdownMenuTrigger({ onMouseEnter, onMouseLeave, ...props }, ref) {
  const hover = useDropdownHoverHandlers();
  return (
    <DropdownMenuPrimitive.Trigger
      ref={ref}
      onMouseEnter={(event) => {
        hover?.onMouseEnter();
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        hover?.onMouseLeave();
        onMouseLeave?.(event);
      }}
      {...props}
    />
  );
});

export function DropdownMenuContent({
  className,
  sideOffset = 4,
  container,
  onMouseEnter,
  onMouseLeave,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
  container?: HTMLElement | null;
}) {
  const hover = useDropdownHoverHandlers();
  return (
    <DropdownMenuPrimitive.Portal container={container ?? undefined}>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        onMouseEnter={(event) => {
          hover?.onMouseEnter();
          onMouseEnter?.(event);
        }}
        onMouseLeave={(event) => {
          hover?.onMouseLeave();
          onMouseLeave?.(event);
        }}
        className={cn(
          "z-50 min-w-32 overflow-hidden rounded-md border bg-background p-1 text-foreground shadow-md",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  inset,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-secondary focus:text-secondary-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-secondary",
        className,
      )}
      checked={checked}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="h-4 w-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  );
}

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none focus:bg-secondary",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle className="h-2 w-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownMenuPrimitive.RadioItem>
  );
}

export function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        "px-2 py-1.5 text-sm font-semibold",
        inset && "pl-8",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-muted", className)}
      {...props}
    />
  );
}

export function DropdownMenuShortcut({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props}
    />
  );
}

export function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        "flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-secondary",
        inset && "pl-8",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRight className="ml-auto h-4 w-4" />
    </DropdownMenuPrimitive.SubTrigger>
  );
}

export function DropdownMenuSubContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>) {
  return (
    <DropdownMenuPrimitive.SubContent
      className={cn(
        "z-50 min-w-32 overflow-hidden rounded-md border bg-background p-1 text-foreground shadow-lg",
        className,
      )}
      {...props}
    />
  );
}
