import {
  Component,
  type ComponentType,
  type ErrorInfo,
  forwardRef,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "../Button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../Card";

export type ErrorFallbackProps = {
  error: Error;
  resetErrorBoundary: () => void;
};

export type ErrorBoundaryFallback =
  | ReactNode
  | ((props: ErrorFallbackProps) => ReactNode);

export type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ErrorBoundaryFallback;
  onError?: (error: Error, info: ErrorInfo) => void;
  onReset?: () => void;
  resetKeys?: readonly unknown[];
};

type ErrorBoundaryState = {
  error: Error | null;
};

function didResetKeysChange(
  prevResetKeys: readonly unknown[] = [],
  resetKeys: readonly unknown[] = [],
) {
  return (
    prevResetKeys.length !== resetKeys.length ||
    prevResetKeys.some((key, index) => !Object.is(key, resetKeys[index]))
  );
}

function DefaultErrorFallback({
  error,
  resetErrorBoundary,
}: ErrorFallbackProps) {
  return (
    <Card className="m-6 max-w-lg border-destructive/40">
      <CardHeader>
        <CardTitle>页面渲染失败</CardTitle>
        <CardDescription>{error.message}</CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" variant="outline" onClick={resetErrorBoundary}>
          重试
        </Button>
      </CardContent>
    </Card>
  );
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps) {
    if (
      this.state.error &&
      didResetKeysChange(prevProps.resetKeys, this.props.resetKeys)
    ) {
      this.resetErrorBoundary();
    }
  }

  resetErrorBoundary = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    const { children, fallback } = this.props;
    const { error } = this.state;

    if (!error) {
      return children;
    }

    const fallbackProps = {
      error,
      resetErrorBoundary: this.resetErrorBoundary,
    };

    if (typeof fallback === "function") {
      return fallback(fallbackProps);
    }

    return fallback ?? <DefaultErrorFallback {...fallbackProps} />;
  }
}

export type WithErrorBoundaryOptions = Omit<ErrorBoundaryProps, "children">;

export function withErrorBoundary<Props extends object, RefValue = unknown>(
  WrappedComponent: ComponentType<Props & { ref?: Ref<RefValue> }>,
  options: WithErrorBoundaryOptions = {},
) {
  const WithErrorBoundary = forwardRef<RefValue, Props>((props, ref) => {
    const wrappedProps = {
      ...props,
      ref,
    } as Props & { ref?: Ref<RefValue> };

    return (
      <ErrorBoundary {...options}>
        <WrappedComponent {...wrappedProps} />
      </ErrorBoundary>
    );
  });

  WithErrorBoundary.displayName = `withErrorBoundary(${
    WrappedComponent.displayName ?? WrappedComponent.name ?? "Component"
  })`;

  return WithErrorBoundary;
}
