import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { cn } from "@packages/shared";

const SiteHeader = forwardRef<
  ElementRef<"header">,
  ComponentPropsWithoutRef<"header">
>(({ className, ...props }, ref) => (
  <header
    ref={ref}
    data-slot="site-header"
    className={cn(
      "flex h-14 shrink-0 items-center gap-4 border-b bg-background px-4 lg:gap-6 lg:px-6",
      className,
    )}
    {...props}
  />
));
SiteHeader.displayName = "SiteHeader";

const SiteHeaderBrand = forwardRef<
  ElementRef<"div">,
  ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="site-header-brand"
    className={cn("flex min-w-0 items-center gap-2 font-semibold", className)}
    {...props}
  />
));
SiteHeaderBrand.displayName = "SiteHeaderBrand";

const SiteHeaderNav = forwardRef<
  ElementRef<"nav">,
  ComponentPropsWithoutRef<"nav">
>(({ className, ...props }, ref) => (
  <nav
    ref={ref}
    data-slot="site-header-nav"
    className={cn("flex items-center gap-1 text-sm", className)}
    {...props}
  />
));
SiteHeaderNav.displayName = "SiteHeaderNav";

const SiteHeaderActions = forwardRef<
  ElementRef<"div">,
  ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="site-header-actions"
    className={cn(
      "ml-auto flex min-w-0 items-center justify-end gap-2",
      className,
    )}
    {...props}
  />
));
SiteHeaderActions.displayName = "SiteHeaderActions";

export { SiteHeader, SiteHeaderActions, SiteHeaderBrand, SiteHeaderNav };
