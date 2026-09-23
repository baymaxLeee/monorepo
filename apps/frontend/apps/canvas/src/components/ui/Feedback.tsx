import { toast, Button as PrimitiveButton } from "@repo/design-system";
import { LoaderCircle } from "lucide-react";
import { forwardRef, type ComponentProps, type CSSProperties, type ReactNode } from "react";

type Notice = ReactNode | { content: ReactNode; duration?: number; id?: string };
function notice(value: Notice, kind: "success" | "error" | "warning" | "info" | "loading") {
  const config = value && typeof value === "object" && "content" in value ? value : { content: value };
  return toast.add({ id: config.id, timeout: config.duration, title: config.content, type: kind });
}
export const Message = {
  success: (value: Notice) => notice(value, "success"),
  error: (value: Notice) => notice(value, "error"),
  warning: (value: Notice) => notice(value, "warning"),
  info: (value: Notice) => notice(value, "info"),
  loading: (value: Notice) => notice(value, "loading"),
  clear: () => toast.close(),
};

export function Spin({
  children,
  loading = true,
  size = 20,
  className,
  style,
  tip,
}: {
  children?: ReactNode;
  loading?: boolean;
  size?: number;
  className?: string;
  style?: CSSProperties;
  tip?: ReactNode;
}) {
  if (!children)
    return loading ? (
      <span role="status" aria-label="加载中" className={className} style={style}>
        <LoaderCircle className="inline-block animate-spin" size={size} />
        {tip}
      </span>
    ) : null;
  return (
    <div aria-busy={loading} className={`relative ${className ?? ""}`} style={style}>
      {children}
      {loading && (
        <div
          role="status"
          aria-label="加载中"
          className="absolute inset-0 flex items-center justify-center gap-2 bg-background/60"
        >
          <LoaderCircle className="animate-spin" size={size} />
          {tip}
        </div>
      )}
    </div>
  );
}

export interface ButtonProps extends Omit<ComponentProps<typeof PrimitiveButton>, "type" | "size"> {
  type?: "default" | "primary" | "secondary" | "outline" | "dashed" | "text";
  htmlType?: "button" | "submit" | "reset";
  size?: "mini" | "small" | "default" | "large";
  icon?: ReactNode;
  iconOnly?: boolean;
  loading?: boolean;
  loadingFixedWidth?: boolean;
  status?: "success" | "danger" | "warning";
  long?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    type = "default",
    htmlType = "button",
    size = "default",
    icon,
    iconOnly,
    loading,
    loadingFixedWidth: _loadingFixedWidth,
    status,
    long,
    className,
    children,
    disabled,
    style,
    ...props
  },
  ref,
) {
  return (
    <PrimitiveButton
      {...props}
      ref={ref}
      type={htmlType}
      disabled={disabled || loading}
      aria-busy={loading}
      variant={
        status === "danger" ? "destructive" : type === "primary" ? "default" : type === "text" ? "ghost" : "outline"
      }
      className={`rounded-lg ${long ? "w-full" : ""} ${className ?? ""}`}
      style={{
        height: { mini: 24, small: 28, default: 32, large: 36 }[size],
        ...(iconOnly ? { padding: 0, aspectRatio: "1" } : {}),
        ...style,
      }}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" /> : icon}
      {children}
    </PrimitiveButton>
  );
});

export function Empty({
  description = "暂无数据",
  icon,
  className,
  style,
}: {
  description?: ReactNode;
  icon?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 py-12 text-sm text-muted-foreground ${className ?? ""}`}
      style={style}
    >
      {icon}
      {description}
    </div>
  );
}
