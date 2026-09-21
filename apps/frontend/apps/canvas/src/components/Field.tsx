import type { ReactNode } from "react";

/** 表单里「小标签 + 控件」的竖排组合。 */
export function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[12px] leading-5 text-[color:var(--color-text-3)]">{label}</span>
      {children}
    </div>
  );
}
