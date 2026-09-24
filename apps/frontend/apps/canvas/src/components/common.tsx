import { MessageResponse } from "@repo/ai-elements";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Dialog,
  DialogContent,
  DialogTitle,
  Input as DesignInput,
  Skeleton as SkeletonPrimitive,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/design-system";
import { usePlatformStore } from "@repo/runtime";
import { Ellipsis, ImageIcon } from "lucide-react";
import { useEffect, useState, type ComponentProps, type CSSProperties, type ReactNode } from "react";

type ButtonProps = ComponentProps<typeof Button> & {
  icon?: ReactNode;
  iconOnly?: boolean;
  status?: "danger";
};

export function EllipsisText({
  children,
  className,
  showPopover,
  popoverProps,
  maxWidth,
  popoverContent,
}: {
  children?: ReactNode;
  className?: string;
  showPopover?: "auto" | boolean;
  popoverProps?: { position?: "top" | "bottom" | "left" | "right" };
  maxWidth?: number;
  popoverContent?: ReactNode;
}) {
  const content = (
    <span
      className={`block truncate ${className ?? ""}`}
      style={maxWidth === undefined ? undefined : { maxWidth }}
      title={showPopover === true ? undefined : typeof children === "string" ? children : undefined}
    >
      {children}
    </span>
  );
  return showPopover === true && (popoverContent ?? children) ? (
    <Tooltip>
      <TooltipTrigger render={content} />
      <TooltipContent side={popoverProps?.position ?? "top"}>{popoverContent ?? children}</TooltipContent>
    </Tooltip>
  ) : (
    content
  );
}

interface Operation {
  name: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  buttonProps?: ButtonProps;
  tooltip?: ReactNode;
}

export function OperationMenu({
  operations,
  className,
  displayNum = 0,
  defaultButtonType = "outline",
  menuButtonProps,
  spaceSize = 8,
  buttonProps,
}: {
  operations: Operation[];
  className?: string;
  displayNum?: number;
  defaultButtonType?: ButtonProps["variant"];
  menuButtonProps?: ButtonProps;
  spaceSize?: number;
  buttonProps?: ButtonProps;
}) {
  const visibleOperations = operations.slice(0, displayNum);
  const overflowOperations = operations.slice(displayNum);
  return (
    <div className={`flex items-center ${className ?? ""}`} style={{ gap: spaceSize }}>
      {visibleOperations.map((operation, index) => (
        <Button
          {...buttonProps}
          {...operation.buttonProps}
          className="c-m-operation-menu-opt-btn min-w-0 flex-1"
          disabled={operation.disabled}
          key={`${String(operation.name)}-${index}`}
          onClick={operation.onClick}
          title={typeof operation.tooltip === "string" ? operation.tooltip : undefined}
          variant={
            operation.buttonProps?.status === "danger"
              ? "destructive"
              : (operation.buttonProps?.variant ?? defaultButtonType)
          }
        >
          {operation.buttonProps?.icon}
          {operation.buttonProps?.iconOnly ? <span className="sr-only">{operation.name}</span> : operation.name}
        </Button>
      ))}
      {overflowOperations.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                aria-label="更多操作"
                className="c-m-operation-menu-dropdown-button"
                {...menuButtonProps}
                size={menuButtonProps?.size ?? "icon-xs"}
              >
                <Ellipsis />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            {overflowOperations.map((operation, index) => (
              <DropdownMenuItem
                className={operation.buttonProps?.status === "danger" ? "text-destructive" : undefined}
                disabled={operation.disabled}
                key={`${String(operation.name)}-${index}`}
                onClick={operation.onClick}
              >
                {operation.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function Result({
  title,
  subTitle,
  extra,
  icon,
  className,
}: {
  status?: string;
  title?: ReactNode;
  subTitle?: ReactNode;
  extra?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-16 text-center ${className ?? ""}`}>
      {icon ?? <ImageIcon className="size-12 text-muted-foreground" />}
      {title ? <h2 className="text-lg font-medium">{title}</h2> : null}
      {subTitle ? <p className="text-sm text-muted-foreground">{subTitle}</p> : null}
      {extra}
    </div>
  );
}

export function ImagePreview({
  src,
  visible,
  onVisibleChange,
  style,
}: {
  src: string;
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
  style?: CSSProperties;
}) {
  return (
    <Dialog open={visible} onOpenChange={onVisibleChange}>
      <DialogContent className="border-0 bg-transparent p-0 shadow-none sm:max-w-[90vw]" style={style}>
        <DialogTitle className="sr-only">图片预览</DialogTitle>
        <img alt="图片预览" className="max-h-[88vh] max-w-[88vw] rounded-xl object-contain" src={src} />
      </DialogContent>
    </Dialog>
  );
}

export function ContentSkeleton({
  className,
  style,
  image,
  text,
}: {
  animation?: boolean;
  className?: string;
  image?: { style?: CSSProperties };
  text?: false | { rows?: number; width?: Array<string | number> };
  style?: CSSProperties;
}) {
  if (!image && !text) return <SkeletonPrimitive className={className} style={style} />;
  return (
    <div aria-hidden className={className} style={style}>
      {image ? <SkeletonPrimitive className="h-full w-full" style={image.style} /> : null}
      {text ? (
        <div className="grid gap-2">
          {Array.from({ length: text.rows ?? 3 }, (_, index) => (
            <SkeletonPrimitive
              className="h-4"
              key={index}
              style={{ width: text.width?.[index] ?? (index === (text.rows ?? 3) - 1 ? "65%" : "100%") }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function Pagination({
  current,
  pageSize,
  total,
  onChange,
  disabled,
  showTotal,
  sizeCanChange,
  sizeOptions = [10, 20, 50],
}: {
  current: number;
  pageSize: number;
  total: number;
  onChange?: (page: number, pageSize: number) => void;
  showTotal?: boolean;
  sizeCanChange?: boolean;
  sizeOptions?: number[];
  disabled?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-end gap-2 text-sm">
      {showTotal ? <span className="text-muted-foreground">共 {total} 项</span> : null}
      <Button disabled={disabled || current <= 1} variant="outline" onClick={() => onChange?.(current - 1, pageSize)}>
        上一页
      </Button>
      <span>
        {current} / {pages}
      </span>
      <Button
        disabled={disabled || current >= pages}
        variant="outline"
        onClick={() => onChange?.(current + 1, pageSize)}
      >
        下一页
      </Button>
      {sizeCanChange ? (
        <Select
          disabled={disabled}
          onValueChange={(next) => next && onChange?.(1, Number(next))}
          value={String(pageSize)}
        >
          <SelectTrigger aria-label="每页数量">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {sizeOptions.map((size) => (
              <SelectItem key={size} value={String(size)}>
                {size} 条/页
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
    </div>
  );
}

export function Markdown({ children, data, className }: { children?: ReactNode; data?: string; className?: string }) {
  return (
    <MessageResponse className={className}>
      {data ?? (typeof children === "string" ? children : String(children ?? ""))}
    </MessageResponse>
  );
}

export function UserLabel({
  id,
  prefix = "",
  className,
}: {
  id: string;
  prefix?: string;
  className?: string;
  stableSign?: boolean;
  showIcon?: boolean;
}) {
  const user = usePlatformStore((state) => state.user);
  const label = id === user?.id ? user.displayName || user.account : id;
  return <span className={className}>{label ? `${prefix}${label}` : "—"}</span>;
}

export function formatDateByCurrentYear(value: string, _format?: unknown) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

interface ConfirmOptions {
  name?: ReactNode;
  targetName?: ReactNode;
  info?: ReactNode;
  onOk: () => void | Promise<unknown>;
  className?: string;
  targetNameLabel?: ReactNode;
  confirmPlaceholder?: string;
}

let confirmListener: ((options: ConfirmOptions) => void) | undefined;

export function openDeleteConfirmDialog(options: ConfirmOptions) {
  confirmListener?.(options);
}

export function ConfirmDialogHost() {
  const [options, setOptions] = useState<ConfirmOptions>();
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    confirmListener = (next) => {
      setConfirmation("");
      setOptions(next);
    };
    return () => {
      confirmListener = undefined;
    };
  }, []);
  const requiredConfirmation =
    options?.confirmPlaceholder && options.targetName ? String(options.targetName) : undefined;
  return (
    <AlertDialog
      open={Boolean(options)}
      onOpenChange={(open) => {
        if (!open && !pending) setOptions(undefined);
      }}
    >
      <AlertDialogContent className={options?.className}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            确认删除{options?.name ? ` ${String(options.name)}` : ""}
            {options?.targetName ? `「${String(options.targetName)}」` : ""}？
          </AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            {options?.info ?? "删除后不可恢复，请谨慎操作。"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {requiredConfirmation ? (
          <label className="grid gap-2 text-sm">
            <span>
              {options?.targetNameLabel ?? "请输入以下内容确认："}
              <strong>{requiredConfirmation}</strong>
            </span>
            <DesignInput
              autoComplete="off"
              disabled={pending}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={options?.confirmPlaceholder}
              value={confirmation}
            />
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending || Boolean(requiredConfirmation && confirmation !== requiredConfirmation)}
            onClick={async (event) => {
              event.preventDefault();
              setPending(true);
              try {
                await options?.onOk();
                setOptions(undefined);
              } finally {
                setPending(false);
              }
            }}
          >
            {pending ? "删除中…" : "删除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
