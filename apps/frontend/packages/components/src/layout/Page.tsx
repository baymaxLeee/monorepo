import type { HTMLAttributes } from "react";
import { cn } from "@packages/shared";

/** Standard content area padding (dashboard pages). */
export function Page({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6",
        className,
      )}
      {...props}
    />
  );
}

export function PageHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
      {...props}
    />
  );
}

export function PageHeaderContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}

export function PageTitle({
  className,
  ...props
}: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h1
      className={cn("text-2xl font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

export function PageDescription({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}

export function PageActions({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}

/** Inline `code` in descriptions — muted chip, no custom classes in apps. */
export function InlineCode({
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <code
      className={cn(
        "relative rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-xs font-medium text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function Muted({
  className,
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props} />
  );
}
