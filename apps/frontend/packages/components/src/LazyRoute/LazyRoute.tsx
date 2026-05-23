import {
  Suspense,
  createElement,
  lazy,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";

type LazyRouteLoader<TProps extends object> = () => Promise<{
  default: ComponentType<TProps>;
}>;

type LazyRouteProps<TProps extends object> = {
  loader: LazyRouteLoader<TProps>;
  fallback?: ReactNode;
};

export function LazyRoute<TProps extends object>({
  loader,
  fallback = <LazyRouteFallback />,
}: LazyRouteProps<TProps>) {
  const Component = useMemo(() => lazy(loader), [loader]);

  return (
    <Suspense fallback={fallback}>
      {createElement(
        Component as unknown as ComponentType<TProps>,
        {} as TProps,
      )}
    </Suspense>
  );
}

function LazyRouteFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    </div>
  );
}

export type { LazyRouteLoader, LazyRouteProps };
