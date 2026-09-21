import {
  Input as NativeInput,
  Textarea,
  Checkbox as NativeCheckbox,
  Select as NativeSelect,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Slider as NativeSlider,
} from "@repo/design-system";
import { X } from "lucide-react";
import {
  Children,
  forwardRef,
  isValidElement,
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type ChangeEvent,
  type CSSProperties,
} from "react";

interface InputProps extends Omit<ComponentProps<typeof NativeInput>, "onChange" | "size" | "prefix"> {
  onChange?: (value: string, event: ChangeEvent<HTMLInputElement>) => void;
  size?: "mini" | "small" | "default" | "large";
  prefix?: ReactNode;
  suffix?: ReactNode;
  allowClear?: boolean;
  onClear?: () => void;
  error?: boolean;
  onPressEnter?: ComponentProps<typeof NativeInput>["onKeyDown"];
  showWordLimit?: boolean;
}
const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput(
  {
    onChange,
    size: _size,
    prefix,
    suffix,
    allowClear,
    onClear,
    error,
    onPressEnter,
    className,
    style,
    onKeyDown,
    ...props
  },
  ref,
) {
  return (
    <span className={`relative inline-flex w-full items-center ${className ?? ""}`} data-ui-input style={style}>
      {prefix && <span className="pointer-events-none absolute left-3 text-muted-foreground">{prefix}</span>}
      <NativeInput
        {...props}
        ref={ref}
        aria-invalid={error}
        className={`${prefix ? "pl-9" : ""} ${allowClear || suffix ? "pr-8" : ""}`}
        data-ui-input-control
        onChange={(event) => onChange?.(event.target.value, event)}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.key === "Enter" && !event.nativeEvent.isComposing) onPressEnter?.(event);
        }}
      />
      {allowClear && props.value && (
        <button
          type="button"
          aria-label="清空"
          className="absolute right-2"
          onClick={(event) => {
            const input = event.currentTarget.parentElement?.querySelector("input");
            if (input) {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              setter?.call(input, "");
              input.dispatchEvent(new Event("input", { bubbles: true }));
            }
            onClear?.();
          }}
        >
          <X className="size-3.5" />
        </button>
      )}
      {suffix && <span className="absolute right-2">{suffix}</span>}
    </span>
  );
});
interface AreaProps extends Omit<ComponentProps<typeof Textarea>, "onChange" | "maxLength"> {
  onChange?: (value: string, event: ChangeEvent<HTMLTextAreaElement>) => void;
  maxLength?: number | { length: number; errorOnly?: boolean };
  autoSize?: boolean | { minRows?: number; maxRows?: number };
  showWordLimit?: boolean;
  wrapperStyle?: CSSProperties;
}
const TextArea = forwardRef<HTMLTextAreaElement, AreaProps>(function TextArea(
  { onChange, maxLength, autoSize, showWordLimit, style, wrapperStyle, ...props },
  ref,
) {
  const minRows = typeof autoSize === "object" ? autoSize.minRows : undefined;
  const maxRows = typeof autoSize === "object" ? autoSize.maxRows : undefined;
  const limit = typeof maxLength === "object" ? maxLength.length : maxLength;
  return (
    <div className="min-h-0 w-full" style={wrapperStyle}>
      <Textarea
        {...props}
        ref={ref}
        rows={minRows ?? props.rows}
        maxLength={typeof maxLength === "object" && maxLength.errorOnly ? undefined : limit}
        style={{
          ...(autoSize
            ? {
                fieldSizing: "content",
                minHeight: `${minRows ?? 2}lh`,
                maxHeight: maxRows ? `${maxRows}lh` : undefined,
              }
            : {}),
          ...style,
        }}
        onChange={(event) => onChange?.(event.target.value, event)}
      />
      {showWordLimit && (
        <div className="text-right text-xs text-muted-foreground">
          {String(props.value ?? "").length}
          {limit ? `/${limit}` : ""}
        </div>
      )}
    </div>
  );
});
export const Input = Object.assign(TextInput, { TextArea });

export function InputNumber({
  value,
  onChange,
  suffix,
  prefix,
  hideControl: _hideControl,
  size: _size,
  precision: _precision,
  ...props
}: Omit<ComponentProps<typeof NativeInput>, "value" | "onChange" | "prefix" | "size"> & {
  value?: number;
  onChange?: (value: number | undefined) => void;
  suffix?: ReactNode;
  prefix?: ReactNode;
  hideControl?: boolean;
  size?: string;
  precision?: number;
}) {
  return (
    <span className="relative inline-flex w-full items-center" data-ui-number-input>
      {prefix}
      <NativeInput
        {...props}
        data-ui-input-control
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange?.(event.target.value === "" ? undefined : event.target.valueAsNumber)}
      />
      {suffix}
    </span>
  );
}

export function Checkbox({
  children,
  checked,
  defaultChecked,
  onChange,
  indeterminate,
  ...props
}: Omit<ComponentProps<typeof NativeCheckbox>, "onChange" | "onCheckedChange" | "checked"> & {
  children?: ReactNode;
  checked?: boolean;
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <NativeCheckbox
        {...props}
        checked={indeterminate ? "indeterminate" : checked}
        defaultChecked={defaultChecked}
        onCheckedChange={(next) => onChange?.(next === true)}
      />
      {children}
    </label>
  );
}

type Value = string | number;
type OptionProps<V extends Value = Value> = { value: V; children?: ReactNode; disabled?: boolean; label?: ReactNode };
function Option<V extends Value>({ children }: OptionProps<V>) {
  return <>{children}</>;
}
interface SelectProps<V extends Value> {
  value?: V;
  defaultValue?: V;
  onChange?: (value: V) => void;
  options?: Array<V | { value: V; label: ReactNode; disabled?: boolean }>;
  children?: ReactNode;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  style?: CSSProperties;
  bordered?: boolean;
  size?: string;
  allowClear?: boolean;
  showSearch?: boolean;
  loading?: boolean;
  dropdownMenuClassName?: string;
  triggerProps?: {
    autoAlignPopupMinWidth?: boolean;
    autoAlignPopupWidth?: boolean;
    style?: CSSProperties;
    position?: string;
  };
  dropdownRender?: (menu: ReactNode) => ReactNode;
  renderFormat?: (option?: OptionProps<V>) => ReactNode;
  filterOption?: (input: string, option: ReactElement<OptionProps<V>>) => boolean;
  "aria-label"?: string;
}
function Selection<V extends Value>({
  value,
  defaultValue,
  onChange,
  options,
  children,
  disabled,
  placeholder,
  className,
  style,
  bordered = true,
  showSearch,
  loading,
  dropdownMenuClassName,
  triggerProps,
  dropdownRender,
  renderFormat,
  filterOption,
  "aria-label": ariaLabel,
}: SelectProps<V>) {
  const [query, setQuery] = useState("");
  const items: OptionProps<V>[] = options
    ? options.map((option) =>
        typeof option === "object"
          ? { ...option, children: option.label }
          : { value: option, children: String(option) },
      )
    : Children.toArray(children).flatMap((child) => (isValidElement<OptionProps<V>>(child) ? [child.props] : []));
  const visibleItems =
    query && filterOption
      ? items.filter((item) => filterOption(query, <Option {...item} />))
      : query
        ? items.filter((item) =>
            String(item.label ?? item.children ?? item.value)
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
          )
        : items;
  const selected = items.find((item) => item.value === value);
  // Prefix values because Radix reserves the empty string for clearing selection.
  const encode = (item: V | undefined) => (item === undefined ? undefined : `value:${String(item)}`);
  const menu = visibleItems.map((item) => (
    <SelectItem key={String(item.value)} value={encode(item.value)!} disabled={item.disabled}>
      {item.children ?? item.label}
    </SelectItem>
  ));
  return (
    <NativeSelect
      value={encode(value)}
      defaultValue={encode(defaultValue)}
      disabled={disabled}
      onOpenChange={(open) => {
        if (!open) setQuery("");
      }}
      onValueChange={(next) => {
        const item = items.find((option) => encode(option.value) === next);
        if (item) onChange?.(item.value);
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className={`${bordered ? "" : "border-0 shadow-none"} ${className ?? ""}`}
        style={style}
      >
        <SelectValue placeholder={placeholder}>
          {selected && renderFormat ? renderFormat(selected) : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent
        className={`agentframe-web-theme ${dropdownMenuClassName ?? ""}`}
        position="popper"
        style={triggerProps?.style}
      >
        {showSearch ? (
          <div className="sticky top-0 z-10 bg-popover p-1">
            <NativeInput
              className="h-8"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="搜索"
              value={query}
            />
          </div>
        ) : null}
        {loading ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">加载中…</div>
        ) : (
          (dropdownRender?.(menu) ?? menu)
        )}
        {!loading && visibleItems.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">暂无匹配项</div>
        ) : null}
      </SelectContent>
    </NativeSelect>
  );
}
export const Select = Object.assign(Selection, { Option });

export function Slider({
  value,
  defaultValue,
  onChange,
  onAfterChange,
  range,
  ...props
}: Omit<ComponentProps<typeof NativeSlider>, "value" | "defaultValue" | "onValueChange" | "onValueCommit"> & {
  value?: number | number[];
  defaultValue?: number | number[];
  onChange?: (value: number | number[]) => void;
  onAfterChange?: (value: number | number[]) => void;
  range?: boolean;
}) {
  const [internal, setInternal] = useState(defaultValue);
  const current = value ?? internal;
  return (
    <NativeSlider
      {...props}
      value={current === undefined ? undefined : Array.isArray(current) ? current : [current]}
      onValueChange={(values) => {
        const next = range ? values : (values[0] ?? 0);
        setInternal(next);
        onChange?.(next);
      }}
      onValueCommit={(values) => onAfterChange?.(range ? values : (values[0] ?? 0))}
    />
  );
}
