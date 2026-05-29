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

type AnyLoader = LazyLoader<unknown>;
type AnyLazyComponent = ComponentType<
  Record<string, unknown> & { ref?: Ref<unknown> }
>;
const lazyComponentCache = new WeakMap<AnyLoader, AnyLazyComponent>();

function resolveLazyComponent(loader: AnyLoader): AnyLazyComponent {
  let cached = lazyComponentCache.get(loader);
  if (!cached) {
    cached = reactLazy(loader) as unknown as AnyLazyComponent;
    lazyComponentCache.set(loader, cached);
  }
  return cached;
}

const LazyImpl = forwardRef<unknown, LazyBaseProps<unknown>>(function Lazy(
  props: any,
  ref,
) {
  const { loader, fallback, ...rest } = props as LazyBaseProps<unknown> &
    Record<string, unknown>;
  const [Component] = useState(() => resolveLazyComponent(loader));
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
