import {
  forwardRef,
  lazy,
  Suspense,
  type ComponentType,
  type ForwardRefExoticComponent,
  type PropsWithoutRef,
  type ReactNode,
  type RefAttributes,
} from "react";

/**
 * 工厂：为"懒加载 + 带 props/ref + 自定义 fallback"的组件入口收敛 boilerplate。
 *
 * 用法（替代手写 `lazy + Suspense + forwardRef`）：
 *
 * ```tsx
 * const MarkdownEditor = createLazyComponent<MarkdownEditorProps, MarkdownEditorRef>(
 *   () => import("./components/Editor"),
 *   ({ style, className, loadingText = "编辑器加载中..." }) => (
 *     <div style={style} className={className}>{loadingText}</div>
 *   ),
 * );
 * MarkdownEditor.displayName = "MarkdownEditor";
 * ```
 *
 * - `loader`：默认导出懒加载入口（可以是 `forwardRef` / `memo` / 普通函数组件）。
 * - `renderFallback`：基于即将渲染的 props 计算 Suspense fallback。
 *   通常用 `style/className/width/height/loadingText` 等渲染一个占位骨架，
 *   保证加载期与就绪态尺寸一致，避免布局抖动。
 *
 * 与项目内 `Lazy` 组件的分工：
 * - `Lazy`：app-level 路由懒加载，无 props / 无 ref / 全屏 fallback；
 * - `createLazyComponent`：组件库入口懒加载，需要 props 透传与 ref 转发。
 *
 * 实现备注：`lazy()` 的类型要求 `default` 为 `ComponentType<P>`，但 `forwardRef + memo`
 * 返回的 `MemoExoticComponent<ForwardRefExoticComponent<...>>` 不直接满足该约束。
 * 这里用 `ComponentType<unknown>` 做最宽松的内层签名，外层再 cast 回正确的
 * `ForwardRefExoticComponent<P, R>`，调用方拿到的 API 是强类型的。
 */
export function createLazyComponent<P extends object, R = unknown>(
  loader: () => Promise<{ default: ComponentType<unknown> }>,
  renderFallback?: (props: P) => ReactNode,
): ForwardRefExoticComponent<PropsWithoutRef<P> & RefAttributes<R>> {
  const LazyInner = lazy(loader) as unknown as ComponentType<
    P & { ref?: React.Ref<R> }
  >;

  return forwardRef<R, P>((props, ref) => (
    <Suspense fallback={renderFallback ? renderFallback(props) : null}>
      <LazyInner {...(props as P)} ref={ref} />
    </Suspense>
  ));
}
