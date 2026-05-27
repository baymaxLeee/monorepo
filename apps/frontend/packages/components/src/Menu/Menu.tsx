import * as React from "react";
import { cn } from "shared";

/**
 * Menu —— 通用菜单容器（纯样式 / 不含 trigger / portal）。
 *
 * 适用场景：外层 popup（FloatingMenu / BubbleMenu / Popover / HoverCard）
 * 已经把定位 + 显隐 + portal 处理好，里层只需要渲染菜单内容。
 *
 * 完整下拉（trigger + content + portal + keyboard nav）请使用 `DropdownMenu`。
 * 上下文（右键）菜单请使用 `ContextMenu` / shadcn 标准方案。
 *
 * 注意：本组件**不内置键盘导航**，若需要请在 trigger 一体的 `DropdownMenu`
 * 体系中实现，或后续升级为 Radix Roving Focus 模式。
 */

export interface MenuProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * @zh 是否内联渲染（不带边框 / 阴影 / 背景）
   * @default false
   * @description 用于 Menu 已经被外层另外加了 popup 外壳的场景，避免重复样式
   */
  inline?: boolean;
}

export function Menu({ className, inline = false, ...props }: MenuProps) {
  return (
    <div
      role="menu"
      data-slot="menu"
      className={cn(
        "min-w-36",
        !inline &&
          "rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        className,
      )}
      {...props}
    />
  );
}

export interface MenuItemProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "type"
> {
  /**
   * @zh 当前选中态（仅文字着色，不带背景）
   * @default false
   */
  active?: boolean;
  /**
   * @zh 危险操作样式
   * @default false
   */
  destructive?: boolean;
  /**
   * @zh 左侧图标 slot（与 children 内手写 svg 二选一即可）
   */
  icon?: React.ReactNode;
  /**
   * @zh 右侧快捷键 / 副标题 slot
   */
  shortcut?: React.ReactNode;
}

export function MenuItem({
  className,
  active = false,
  destructive = false,
  icon,
  shortcut,
  disabled,
  children,
  ...props
}: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      data-slot="menu-item"
      data-active={active ? "" : undefined}
      data-destructive={destructive ? "" : undefined}
      disabled={disabled}
      className={cn(
        "flex h-8 w-full select-none items-center gap-2 rounded-sm px-2 text-left text-sm outline-none transition-colors",
        "[&>svg]:size-4 [&>svg]:shrink-0",
        "hover:bg-accent focus-visible:bg-accent",
        "disabled:pointer-events-none disabled:opacity-50",
        active && "text-blue-600 focus-visible:text-blue-600",
        destructive &&
          "text-destructive hover:text-destructive focus-visible:text-destructive",
        className,
      )}
      {...props}
    >
      {icon ? (
        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">
          {icon}
        </span>
      ) : null}
      {children}
      {shortcut ? (
        <span className="ml-auto text-xs tracking-widest text-muted-foreground">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

export interface MenuItemGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * @zh 分组 label
   */
  label?: React.ReactNode;
}

export function MenuItemGroup({
  label,
  className,
  children,
  ...props
}: MenuItemGroupProps) {
  return (
    <div
      role="group"
      data-slot="menu-group"
      className={cn("py-0.5", className)}
      {...props}
    >
      {label ? <MenuLabel>{label}</MenuLabel> : null}
      {children}
    </div>
  );
}

export function MenuLabel({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="menu-label"
      className={cn(
        "px-2 py-1 text-xs font-medium text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: React.HTMLAttributes<HTMLHRElement>) {
  return (
    <hr
      data-slot="menu-separator"
      className={cn("-mx-1 my-1 border-border", className)}
      {...props}
    />
  );
}
