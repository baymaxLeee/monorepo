import { Spinner } from "@repo/design-system";
import type { CSSProperties, ReactNode } from "react";

export function LoadingIndicator({
  children,
  loading = true,
  className,
  style,
  label = "加载中",
}: {
  children?: ReactNode;
  loading?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: ReactNode;
}) {
  if (!children) {
    return loading ? (
      <span aria-label={typeof label === "string" ? label : "加载中"} className={className} role="status" style={style}>
        <Spinner />
        {label}
      </span>
    ) : null;
  }

  return (
    <div aria-busy={loading} className={`relative ${className ?? ""}`} style={style}>
      {children}
      {loading ? (
        <div
          aria-label={typeof label === "string" ? label : "加载中"}
          className="absolute inset-0 flex items-center justify-center gap-2 bg-background/60"
          role="status"
        >
          <Spinner />
          {label}
        </div>
      ) : null}
    </div>
  );
}
