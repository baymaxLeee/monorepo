import { Popover as PopoverPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "shared";
import {
  type HoverTriggerHandlers,
  type TriggerKind,
  useHoverTrigger,
} from "../utils/useHoverTrigger";

const PopoverHoverContext = React.createContext<HoverTriggerHandlers | null>(
  null,
);
const usePopoverHoverHandlers = () => React.useContext(PopoverHoverContext);

export interface PopoverProps
  extends React.ComponentProps<typeof PopoverPrimitive.Root> {
  /** 触发方式，参考 arco `Trigger.trigger`，默认 `"click"`。 */
  trigger?: TriggerKind;
  /** 鼠标进入后延时打开（毫秒），仅 `trigger="hover"` 生效，默认 80。 */
  hoverEnterDelay?: number;
  /** 鼠标移出后延时关闭（毫秒），仅 `trigger="hover"` 生效，默认 200。 */
  hoverCloseDelay?: number;
}

function Popover({
  trigger = "click",
  hoverEnterDelay,
  hoverCloseDelay,
  open,
  defaultOpen,
  onOpenChange,
  children,
  ...rootProps
}: PopoverProps) {
  const hover = useHoverTrigger({
    trigger,
    open,
    defaultOpen,
    onOpenChange,
    hoverEnterDelay,
    hoverCloseDelay,
  });

  if (!hover.enabled) {
    return (
      <PopoverPrimitive.Root
        data-slot="popover"
        open={open}
        defaultOpen={defaultOpen}
        onOpenChange={onOpenChange}
        {...rootProps}
      >
        {children}
      </PopoverPrimitive.Root>
    );
  }

  return (
    <PopoverHoverContext.Provider value={hover.handlers}>
      <PopoverPrimitive.Root
        data-slot="popover"
        open={hover.open}
        onOpenChange={hover.setOpen}
        {...rootProps}
      >
        {children}
      </PopoverPrimitive.Root>
    </PopoverHoverContext.Provider>
  );
}

// forwardRef：嵌套 `asChild` 时（例如外层 TooltipTrigger 包裹本组件），
// 上层 SlotClone 会向 PopoverTrigger 传 ref，function 组件接不住会触发 React warning。
const PopoverTrigger = React.forwardRef<
  React.ComponentRef<typeof PopoverPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Trigger>
>(function PopoverTrigger({ onMouseEnter, onMouseLeave, ...props }, ref) {
  const hover = usePopoverHoverHandlers();
  return (
    <PopoverPrimitive.Trigger
      ref={ref}
      data-slot="popover-trigger"
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

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  container,
  onMouseEnter,
  onMouseLeave,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  container?: HTMLElement | null;
}) {
  const hover = usePopoverHoverHandlers();
  return (
    <PopoverPrimitive.Portal container={container ?? undefined}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
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
          "z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-hidden",
          "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
