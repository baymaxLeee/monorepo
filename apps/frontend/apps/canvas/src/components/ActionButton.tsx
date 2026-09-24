import type { ReactNode } from "react";

import { AsyncButton } from "@/components/AsyncButton";

type ButtonSize = 28 | 32 | 36;
type ButtonVariant = "default" | "primary" | "success";

const BUTTON_SIZE: Record<ButtonSize, "sm" | "default" | "lg"> = {
  28: "sm",
  32: "default",
  36: "lg",
};

const ICON_SIZE: Record<ButtonSize, string> = {
  28: "text-[14px]",
  32: "text-[16px]",
  36: "text-[16px]",
};

const PADDING_X: Record<12 | 16, string> = {
  12: "px-3",
  16: "px-4",
};

/**
 * 业务按钮统一复用应用按钮的状态和 loading 能力，这里只保留设计稿要求的
 * 字号、字距、圆角和紧凑横向间距。
 */
export function ActionButton({
  active = false,
  ariaLabel,
  children,
  disabled = false,
  icon,
  loading = false,
  paddingX = 16,
  size = 32,
  square = false,
  variant = "default",
  onClick,
}: {
  active?: boolean;
  ariaLabel?: string;
  children?: ReactNode;
  disabled?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  paddingX?: 12 | 16;
  size?: ButtonSize;
  square?: boolean;
  variant?: ButtonVariant;
  onClick?: () => void;
}) {
  return (
    <AsyncButton
      aria-label={ariaLabel}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-[8px] text-[13px] font-medium leading-5.5 tracking-[0.3px] ${
        square ? "px-0" : PADDING_X[paddingX]
      } ${active && variant === "default" ? "border-primary" : ""} ${
        variant === "success" && !disabled ? "border-primary bg-background text-primary" : ""
      }`}
      disabled={disabled}
      loading={loading}
      onClick={onClick}
      size={square ? "icon" : BUTTON_SIZE[size]}
      variant={variant === "primary" ? "default" : "outline"}
    >
      {icon ? (
        <span className={`inline-flex items-center justify-center leading-[0] ${ICON_SIZE[size]}`}>{icon}</span>
      ) : undefined}
      {children}
    </AsyncButton>
  );
}
