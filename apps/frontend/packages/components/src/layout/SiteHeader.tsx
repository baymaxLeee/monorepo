import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@packages/shared";

export function SiteHeader({
  className,
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <header
      className={cn(
        "flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4 lg:gap-6 lg:px-6",
        className,
      )}
      {...props}
    >
      {children}
    </header>
  );
}

export function SiteHeaderBrand({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex items-center gap-2 font-semibold", className)} {...props} />
  );
}

export function SiteHeaderNav({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <nav
      className={cn("flex items-center gap-1 text-sm", className)}
      {...props}
    />
  );
}

export function SiteHeaderActions({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("ml-auto flex items-center gap-2", className)}
      {...props}
    />
  );
}
