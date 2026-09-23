import {
  Popover as PrimitivePopover,
  PopoverContent,
  PopoverTrigger,
  Tooltip as PrimitiveTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/design-system";
import { isValidElement, useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

type Position = "top" | "bottom" | "left" | "right" | "tl" | "tr" | "bl" | "br" | "lt" | "lb" | "rt" | "rb";
function placement(position: Position = "bottom") {
  const side = ({ t: "top", b: "bottom", l: "left", r: "right" } as const)[position[0] as "t" | "b" | "l" | "r"];
  const align = position.length === 2 ? ("lt".includes(position[1]) ? "start" : "end") : "center";
  return { side, align } as const;
}

interface FloatingProps {
  children: ReactNode;
  position?: Position;
  popupVisible?: boolean;
  defaultPopupVisible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  getPopupContainer?: (trigger?: HTMLElement) => HTMLElement;
  popupAlign?: Partial<Record<Position, [number, number] | number>>;
}

export interface TooltipProps extends FloatingProps {
  content: ReactNode;
  mini?: boolean;
  trigger?: "hover" | "click";
  triggerProps?: { style?: CSSProperties };
}

/** Keep the source placement contract while using the shared Base UI tooltip. */
export function Tooltip({
  children,
  content,
  position = "top",
  popupVisible,
  defaultPopupVisible,
  onVisibleChange,
  disabled,
  className,
  style,
  getPopupContainer,
  triggerProps,
}: TooltipProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultPopupVisible ?? false);
  if (disabled || content == null || content === "") return <>{children}</>;
  const child = isValidElement<{ disabled?: boolean }>(children) ? children : undefined;
  const render = child && !child.props.disabled ? (child as ReactElement) : <span className="inline-flex max-w-full" />;
  return (
    <PrimitiveTooltip
      open={popupVisible ?? uncontrolledOpen}
      onOpenChange={(open) => {
        if (popupVisible === undefined) setUncontrolledOpen(open);
        onVisibleChange?.(open);
      }}
    >
      <TooltipTrigger render={render}>{render === child ? undefined : children}</TooltipTrigger>
      <TooltipContent
        {...placement(position)}
        className={`canvas-web-theme ${className ?? ""}`}
        style={{ ...triggerProps?.style, ...style }}
        container={getPopupContainer?.()}
      >
        {content}
      </TooltipContent>
    </PrimitiveTooltip>
  );
}

export interface TriggerProps extends FloatingProps {
  popup: () => ReactNode;
  trigger?: "hover" | "click" | "contextMenu" | Array<"hover" | "click" | "contextMenu">;
  unmountOnExit?: boolean;
  mouseEnterDelay?: number;
  mouseLeaveDelay?: number;
  autoAlignPopupWidth?: boolean;
  autoAlignPopupMinWidth?: boolean;
  clickToClose?: boolean;
  clickOutsideToClose?: boolean;
  popupHoverStay?: boolean;
}

function resolveTrigger(children: ReactNode) {
  const element = isValidElement(children) ? (children as ReactElement) : <button type="button">{children}</button>;
  return {
    element,
    nativeButton: typeof element.type !== "string" || element.type === "button",
  };
}

export function Trigger({
  children,
  popup,
  position,
  popupVisible,
  defaultPopupVisible,
  onVisibleChange,
  disabled,
  className,
  style,
  getPopupContainer,
  trigger = "click",
  mouseEnterDelay,
  mouseLeaveDelay,
  autoAlignPopupWidth,
  autoAlignPopupMinWidth,
  clickOutsideToClose = true,
  popupAlign,
}: TriggerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultPopupVisible ?? false);
  const hover = Array.isArray(trigger) ? trigger.includes("hover") : trigger === "hover";
  const resolvedPlacement = placement(position);
  const offset = popupAlign?.[position ?? "bottom"] ?? popupAlign?.[resolvedPlacement.side];
  const alignOffset = typeof offset === "number" ? 0 : offset?.[0];
  const sideOffset = typeof offset === "number" ? offset : offset?.[1];
  const resolvedTrigger = resolveTrigger(children);
  useEffect(() => {
    if (disabled) setUncontrolledOpen(false);
  }, [disabled]);
  return (
    <PrimitivePopover
      open={disabled ? false : (popupVisible ?? uncontrolledOpen)}
      onOpenChange={(open, details) => {
        if (disabled) {
          details.cancel();
          return;
        }
        if (!clickOutsideToClose && details.reason === "outside-press") {
          details.cancel();
          return;
        }
        if (popupVisible === undefined) setUncontrolledOpen(open);
        onVisibleChange?.(open);
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        openOnHover={hover}
        delay={mouseEnterDelay == null ? undefined : mouseEnterDelay * 1000}
        closeDelay={mouseLeaveDelay == null ? undefined : mouseLeaveDelay * 1000}
        render={resolvedTrigger.element}
        nativeButton={resolvedTrigger.nativeButton}
      />
      <PopoverContent
        {...resolvedPlacement}
        alignOffset={alignOffset}
        sideOffset={sideOffset}
        container={getPopupContainer?.()}
        className={`canvas-web-theme w-auto rounded-xl p-0 ${className ?? ""}`}
        style={{
          ...(autoAlignPopupWidth ? { width: "var(--anchor-width)" } : {}),
          ...(autoAlignPopupMinWidth ? { minWidth: "var(--anchor-width)" } : {}),
          ...style,
        }}
        initialFocus={false}
      >
        {popup()}
      </PopoverContent>
    </PrimitivePopover>
  );
}

export interface DropdownProps extends Omit<TriggerProps, "popup"> {
  droplist: ReactNode;
  triggerProps?: Partial<TriggerProps>;
}
export function Dropdown({ droplist, triggerProps, ...props }: DropdownProps) {
  return <Trigger {...triggerProps} {...props} popup={() => droplist} />;
}

export function Popover({
  content,
  title,
  triggerProps,
  ...props
}: Omit<TriggerProps, "popup"> & { content: ReactNode; title?: ReactNode; triggerProps?: Partial<TriggerProps> }) {
  return (
    <Trigger
      {...triggerProps}
      {...props}
      popup={() => (
        <div className="p-3">
          {title && <div className="mb-2 font-medium">{title}</div>}
          {content}
        </div>
      )}
    />
  );
}
