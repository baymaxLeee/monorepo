import { forwardRef } from "react";
import type { ComponentPropsWithoutRef, ElementRef } from "react";
import { cn } from "@packages/shared";

const Layout = forwardRef<ElementRef<"div">, ComponentPropsWithoutRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      data-slot="layout"
      className={cn("flex min-h-svh flex-col bg-background", className)}
      {...props}
    />
  ),
);
Layout.displayName = "Layout";

const Header = forwardRef<
  ElementRef<"header">,
  ComponentPropsWithoutRef<"header">
>(({ className, ...props }, ref) => (
  <header
    ref={ref}
    data-slot="layout-header"
    className={cn(
      "grid h-14 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 border-b px-4",
      className,
    )}
    {...props}
  />
));
Header.displayName = "Header";

const HeaderSection = forwardRef<
  ElementRef<"div">,
  ComponentPropsWithoutRef<"div">
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="layout-header-section"
    className={cn("flex min-w-0 items-center", className)}
    {...props}
  />
));
HeaderSection.displayName = "HeaderSection";

const Aside = forwardRef<
  ElementRef<"aside">,
  ComponentPropsWithoutRef<"aside">
>(({ className, ...props }, ref) => (
  <aside
    ref={ref}
    data-slot="layout-aside"
    className={cn("flex min-h-0 flex-col border-r bg-sidebar", className)}
    {...props}
  />
));
Aside.displayName = "Aside";

const Main = forwardRef<ElementRef<"main">, ComponentPropsWithoutRef<"main">>(
  ({ className, ...props }, ref) => (
    <main
      ref={ref}
      data-slot="layout-main"
      className={cn("min-h-0 flex-1", className)}
      {...props}
    />
  ),
);
Main.displayName = "Main";

const Section = forwardRef<
  ElementRef<"section">,
  ComponentPropsWithoutRef<"section">
>(({ className, ...props }, ref) => (
  <section
    ref={ref}
    data-slot="layout-section"
    className={cn("min-w-0", className)}
    {...props}
  />
));
Section.displayName = "Section";

export { Aside, Header, HeaderSection, Layout, Main, Section };
