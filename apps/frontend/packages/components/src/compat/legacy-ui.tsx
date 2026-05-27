import { cn } from "shared";
import React from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import { Button as BaseButton } from "../Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../DropdownMenu";
import { Input as BaseInput } from "../Input";
import { Popover, PopoverContent, PopoverTrigger } from "../Popover";
import {
  Select as BaseSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../Select";
import { toast } from "../Sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../Tooltip";

type ArcoPosition =
  | "top"
  | "tl"
  | "tr"
  | "bottom"
  | "bl"
  | "br"
  | "left"
  | "lt"
  | "lb"
  | "right"
  | "rt"
  | "rb";

type RadixSide = "top" | "right" | "bottom" | "left";
type RadixAlign = "start" | "center" | "end";

function mapArcoPosition(position: ArcoPosition): {
  side: RadixSide;
  align: RadixAlign;
} {
  switch (position) {
    case "top":
      return { side: "top", align: "center" };
    case "tl":
      return { side: "top", align: "start" };
    case "tr":
      return { side: "top", align: "end" };
    case "bottom":
      return { side: "bottom", align: "center" };
    case "bl":
      return { side: "bottom", align: "start" };
    case "br":
      return { side: "bottom", align: "end" };
    case "left":
      return { side: "left", align: "center" };
    case "lt":
      return { side: "left", align: "start" };
    case "lb":
      return { side: "left", align: "end" };
    case "right":
      return { side: "right", align: "center" };
    case "rt":
      return { side: "right", align: "start" };
    case "rb":
      return { side: "right", align: "end" };
  }
}

type AnyProps = Record<string, unknown> & { children?: React.ReactNode };

export function Button({
  icon,
  children,
  className,
  shape,
  size,
  type,
  htmlType,
  ...props
}: AnyProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
    type?: string;
    htmlType?: React.ButtonHTMLAttributes<HTMLButtonElement>["type"];
  }) {
  return (
    <BaseButton
      {...props}
      type={htmlType ?? (type === "submit" ? "submit" : "button")}
      size={shape === "circle" || !children ? "icon" : "sm"}
      className={cn(
        size === "mini" && "h-7 min-w-7 text-xs",
        className as string,
      )}
    >
      {icon as React.ReactNode}
      {children}
    </BaseButton>
  );
}

Button.Group = function ButtonGroup({
  children,
  className,
}: AnyProps & { className?: string }) {
  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      {children}
    </div>
  );
};

export function Input({
  prefix,
  suffix,
  className,
  onChange,
  size: _size,
  ...props
}: AnyProps &
  Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "prefix" | "onChange" | "size"
  > & {
    onChange?: (value: string) => void;
    size?: string;
  }) {
  return (
    <div className="relative flex items-center">
      {prefix ? (
        <span className="absolute left-2 text-muted-foreground">
          {prefix as React.ReactNode}
        </span>
      ) : null}
      <BaseInput
        {...props}
        className={cn(
          Boolean(prefix) && "pl-8",
          Boolean(suffix) && "pr-8",
          className as string,
        )}
        onChange={(event) => onChange?.(event.currentTarget.value)}
      />
      {suffix ? (
        <span className="absolute right-2 text-xs text-muted-foreground">
          {suffix as React.ReactNode}
        </span>
      ) : null}
    </div>
  );
}

Input.TextArea = function TextArea({
  className,
  onChange,
  ...props
}: AnyProps &
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & {
    onChange?: (value: string) => void;
  }) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      onChange={(event) => onChange?.(event.currentTarget.value)}
    />
  );
};

export function InputNumber({
  suffix,
  className,
  onChange,
  size: _size,
  ...props
}: AnyProps &
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "size"> & {
    onChange?: (value: number | undefined) => void;
    size?: string;
  }) {
  return (
    <BaseInput
      {...props}
      type="number"
      className={cn("h-7", className as string)}
      onChange={(event) => onChange?.(event.currentTarget.valueAsNumber)}
    />
  );
}

export function Select({
  options = [],
  value,
  defaultValue,
  placeholder,
  onChange,
  children,
  className,
}: AnyProps & {
  options?: Array<{ label: React.ReactNode; value: string }>;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  className?: string;
}) {
  return (
    <BaseSelect
      value={value}
      defaultValue={defaultValue}
      onValueChange={onChange}
    >
      <SelectTrigger className={cn("h-8", className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {children ??
          options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
      </SelectContent>
    </BaseSelect>
  );
}

Select.Option = function SelectOption({
  children,
  value,
}: AnyProps & { value?: string }) {
  return <SelectItem value={value ?? String(children)}>{children}</SelectItem>;
};

export function LegacyTooltip({
  content,
  children,
}: AnyProps & { content?: React.ReactNode }) {
  if (!content) return <>{children}</>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{content}</TooltipContent>
    </Tooltip>
  );
}

export { LegacyTooltip as Tooltip };

export function Dropdown({
  droplist,
  children,
  disabled,
}: AnyProps & { droplist?: React.ReactNode; disabled?: boolean }) {
  if (disabled) return <>{children}</>;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="start">{droplist}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuRoot({
  children,
  className,
  onClickMenuItem,
}: AnyProps & { className?: string; onClickMenuItem?: (key: any) => void }) {
  return (
    <div
      className={cn(
        "min-w-36 rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        className,
      )}
    >
      <MenuContext.Provider value={{ onClickMenuItem }}>
        {children}
      </MenuContext.Provider>
    </div>
  );
}

const MenuContext = React.createContext<{
  onClickMenuItem?: (key: any) => void;
}>({});

function MenuItem({
  children,
  className,
  disabled,
  onClick,
  ...props
}: AnyProps & {
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  key?: React.Key;
}) {
  const context = React.useContext(MenuContext);
  const itemKey = String(
    (props as { eventKey?: string; key?: React.Key }).eventKey ??
      props.key ??
      "",
  );
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none hover:bg-accent disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      onClick={() => {
        onClick?.();
        if (itemKey) context.onClickMenuItem?.(itemKey);
      }}
    >
      {children}
    </button>
  );
}

function SubMenu({
  title,
  children,
  className,
}: AnyProps & { title?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("py-1", className)}>
      {title ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">{title}</div>
      ) : null}
      {children}
    </div>
  );
}

function ItemGroup({
  title,
  children,
}: AnyProps & { title?: React.ReactNode }) {
  return (
    <div className="py-1">
      {title ? (
        <div className="px-2 py-1 text-xs text-muted-foreground">{title}</div>
      ) : null}
      {children}
    </div>
  );
}

export const Menu = Object.assign(MenuRoot, {
  Item: MenuItem,
  SubMenu,
  ItemGroup,
});

/**
 * Legacy arco-style `Trigger`, reimplemented on top of radix Popover (click /
 * focus / contextMenu) and HoverCard (hover). Preserves the original prop
 * surface so call sites under MarkdownEditor don't need to change.
 *
 * - `position` ("tl" | "bl" | ...) maps to radix `side` + `align`.
 * - `popupAlign: { [side]: number }` maps to radix `sideOffset`.
 * - `disabled` short-circuits to render only the children.
 */
export function Trigger({
  children,
  popup,
  popupVisible,
  onVisibleChange,
  trigger = "click",
  position = "bottom",
  popupAlign,
  disabled,
  className,
}: {
  children: React.ReactNode;
  popup?: () => React.ReactNode;
  popupVisible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
  trigger?: "click" | "hover" | "focus" | "contextMenu";
  position?: ArcoPosition;
  popupAlign?: Partial<Record<RadixSide, number>>;
  disabled?: boolean;
  showArrow?: boolean;
  className?: string;
}) {
  if (disabled || !popup) {
    return <>{children}</>;
  }
  const { side, align } = mapArcoPosition(position);
  const sideOffset = popupAlign?.[side] ?? 4;
  const child = React.Children.only(children) as React.ReactElement;
  const contentClass = cn("w-auto p-2 shadow-md", className);

  if (trigger === "hover") {
    return (
      <HoverCardPrimitive.Root
        open={popupVisible}
        onOpenChange={onVisibleChange}
        openDelay={120}
        closeDelay={120}
      >
        <HoverCardPrimitive.Trigger asChild>{child}</HoverCardPrimitive.Trigger>
        <HoverCardPrimitive.Portal>
          <HoverCardPrimitive.Content
            side={side}
            align={align}
            sideOffset={sideOffset}
            className={cn(
              "z-50 origin-(--radix-hover-card-content-transform-origin) rounded-md border bg-popover text-popover-foreground outline-hidden",
              "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
              "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
              contentClass,
            )}
          >
            {popup()}
          </HoverCardPrimitive.Content>
        </HoverCardPrimitive.Portal>
      </HoverCardPrimitive.Root>
    );
  }

  return (
    <Popover open={popupVisible} onOpenChange={onVisibleChange}>
      <PopoverTrigger asChild>{child}</PopoverTrigger>
      <PopoverContent
        side={side}
        align={align}
        sideOffset={sideOffset}
        className={contentClass}
      >
        {popup()}
      </PopoverContent>
    </Popover>
  );
}

export function Spin() {
  return (
    <span className="inline-block size-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
  );
}

export function Space({
  children,
  className,
}: AnyProps & { className?: string }) {
  return (
    <div className={cn("inline-flex items-center gap-2", className)}>
      {children}
    </div>
  );
}

export const Message = {
  success: (content: React.ReactNode) => toast.success(String(content)),
  error: (content: React.ReactNode) => toast.error(String(content)),
  warning: (content: React.ReactNode) => toast.warning(String(content)),
  info: (content: React.ReactNode) => toast(String(content)),
};

// Note: a previous fake `Form / Form.useForm` shim was removed because it
// silently no-op'd `validate()` and ignored arco-style `rules`. The only
// consumer (LinkMenu) now uses react-hook-form + zod directly. Do not add
// such a shim back; if a new caller needs forms, wire up RHF at the call
// site (or build a thin local helper) so validation actually runs.
