import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary";
  children: ReactNode;
}

const styles: Record<NonNullable<ButtonProps["variant"]>, React.CSSProperties> = {
  primary: {
    background: "#2563eb",
    color: "white",
    border: "1px solid #1d4ed8",
  },
  secondary: {
    background: "#f1f5f9",
    color: "#0f172a",
    border: "1px solid #cbd5e1",
  },
};

export function Button({ variant = "primary", style, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      style={{
        padding: "8px 16px",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 500,
        ...styles[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
}
