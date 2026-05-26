import { cn } from "shared";
import React from "react";
import { Button as BaseButton } from "../Button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../DropdownMenu";
import { Input as BaseInput } from "../Input";
import {
  Select as BaseSelect,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../Select";
import { toast } from "../Sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "../Tooltip";

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

export function Trigger({
  children,
  popup,
  popupVisible,
}: AnyProps & {
  popup?: () => React.ReactNode;
  popupVisible?: boolean;
  onVisibleChange?: (visible: boolean) => void;
}) {
  return (
    <>
      {children}
      {popupVisible ? popup?.() : null}
    </>
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

type LegacyFormInstance = {
  resetFields: () => void;
  setFieldsValue: (values: Record<string, unknown>) => void;
  getFieldsValue: () => Record<string, unknown>;
  validate: () => Promise<void>;
};

function createFormInstance(): LegacyFormInstance {
  let values: Record<string, unknown> = {};
  return {
    resetFields: () => {
      values = {};
    },
    setFieldsValue: (next) => {
      values = { ...values, ...next };
    },
    getFieldsValue: () => values,
    validate: async () => undefined,
  };
}

function FormRoot({
  children,
  onSubmit,
  onKeyDown,
}: AnyProps & {
  onSubmit?: (values: any) => void;
  onKeyDown?: React.KeyboardEventHandler<HTMLFormElement>;
}) {
  const [form] = React.useState(createFormInstance);
  return (
    <form
      className="grid gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(form.getFieldsValue());
      }}
      onKeyDown={onKeyDown}
    >
      {children}
    </form>
  );
}

function FormItem({ children, label }: AnyProps & { label?: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm">
      {label ? <span className="text-muted-foreground">{label}</span> : null}
      {children}
    </label>
  );
}

export const Form = Object.assign(FormRoot, {
  Item: FormItem,
  useForm: () => [createFormInstance()] as const,
});
