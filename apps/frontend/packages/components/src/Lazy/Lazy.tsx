import {
  Suspense,
  lazy,
  useMemo,
  type ComponentType,
  type ReactNode,
} from "react";

type LazyLoader = () => Promise<{
  default: ComponentType;
}>;

type LazyProps = {
  loader: LazyLoader;
  fallback?: ReactNode;
};

function LazyFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-foreground" />
    </div>
  );
}

export const Lazy: React.FC<LazyProps> = ({
  loader,
  fallback = <LazyFallback />,
}) => {
  const Component = useMemo(() => lazy(loader), [loader]);

  return (
    <Suspense fallback={fallback}>
      <Component />
    </Suspense>
  );
};
