import type { ReactNode } from "react";

import { Button } from "@/components/ui";

type ButtonSize = 28 | 32 | 36;
type ButtonVariant = "default" | "primary" | "success";

const BUTTON_SIZE: Record<ButtonSize, "small" | "default" | "large"> = {
  28: "small",
  32: "default",
  36: "large",
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
    <Button
      aria-label={ariaLabel}
      className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-[8px] text-[13px] font-medium leading-5.5 tracking-[0.3px] ${
        square ? "px-0" : PADDING_X[paddingX]
      } ${active && variant === "default" ? "border-primary" : ""} ${
        variant === "success" && !disabled ? "border-[#5cae77]! bg-white! text-[#2a814b]!" : ""
      }`}
      disabled={disabled}
      icon={
        icon ? (
          <span className={`inline-flex items-center justify-center leading-[0] ${ICON_SIZE[size]}`}>{icon}</span>
        ) : undefined
      }
      iconOnly={square}
      loading={loading}
      loadingFixedWidth
      onClick={onClick}
      size={BUTTON_SIZE[size]}
      status={variant === "success" ? "success" : undefined}
      type={variant === "primary" ? "primary" : "default"}
    >
      {children}
    </Button>
  );
}
