import {
  type ComponentType,
  forwardRef,
  type ReactElement,
  type ReactNode,
  type Ref,
  lazy as reactLazy,
  Suspense,
  useState,
} from "react";

/**
 * Lazy —— 路由 + 组件统一懒加载入口。
 *
 * 设计原则：使用方**只关注 loader**，其余样板（lazy / Suspense / fallback / ref / props 透传）
 * 全部由本组件吸收。
 *
 * 示例：
 * ```tsx
 * // 路由
 * { path: "404", element: <Lazy loader={() => import("../pages/404")} /> }
 *
 * // 组件入口（无需 ref）
 * export const Foo = (props: FooProps) => (
 *   <Lazy loader={() => import("./components/Inner")} {...props} />
 * );
 *
 * // 组件入口（需要 ref forward 到目标组件）
 * export const Bar = forwardRef<BarRef, BarProps>((props, ref) => (
 *   <Lazy<BarProps> loader={() => import("./components/Inner")} ref={ref} {...props} />
 * ));
 * ```
 */
export type LazyLoader<P> = () => Promise<{ default: ComponentType<P> }>;

export interface LazyBaseProps<P> {
  /** 异步组件 loader */
  loader: LazyLoader<P>;
  /** Suspense fallback；不传则使用全屏居中 spinner */
  fallback?: ReactNode;
}

function DefaultFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    </div>
  );
}

// Lazy 内部用 any 承接异构 props（消费方在外层通过泛型给具体类型）。
// 对外通过下方 `as` 转型暴露强类型签名。
const LazyImpl = forwardRef<unknown, LazyBaseProps<unknown>>(function Lazy(
  props: any,
  ref,
) {
  const { loader, fallback, ...rest } = props as LazyBaseProps<unknown> &
    Record<string, unknown>;
  // useState lazy initializer：保证仅在挂载时调用一次 lazy()，
  // 即便消费方传入的 loader 是行内箭头函数（每次渲染新引用）也不会重建。
  const [Component] = useState(
    () =>
      reactLazy(loader as LazyLoader<unknown>) as unknown as ComponentType<
        Record<string, unknown> & { ref?: Ref<unknown> }
      >,
  );
  return (
    <Suspense fallback={(fallback as ReactNode) ?? <DefaultFallback />}>
      <Component ref={ref} {...rest} />
    </Suspense>
  );
});

LazyImpl.displayName = "Lazy";

export const Lazy = LazyImpl as unknown as <P extends object = object>(
  props: LazyBaseProps<P> & P & { ref?: Ref<unknown> },
) => ReactElement;
