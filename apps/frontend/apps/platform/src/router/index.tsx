import { loadRemote } from "@module-federation/enhanced/runtime";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorBoundary,
  type ErrorFallbackProps,
  type LazyLoader,
  Skeleton,
} from "components";
import { type ComponentType, lazy, Suspense } from "react";
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
  useParams,
} from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { type AppEntry, remoteModuleId, useAppsStore } from "../store/apps";

type RouteLoader = LazyLoader<object>;

/** A federated remote module exposing its app as the default export. */
type RemoteModule = { default: ComponentType };

function lazyPage(loader: RouteLoader): RouteObject["lazy"] {
  return async () => {
    const module = await loader();
    return { Component: module.default as ComponentType };
  };
}

// Cache lazy remote components by module id so navigation doesn't recreate them.
const remoteComponents = new Map<string, ComponentType>();

function getRemoteComponent(app: AppEntry): ComponentType {
  const moduleId = remoteModuleId(app);
  const cached = remoteComponents.get(moduleId);
  if (cached) return cached;
  const RemoteLazy = lazy(async () => {
    const module = await loadRemote<RemoteModule>(moduleId);
    if (!module?.default) {
      throw new Error(
        `Remote "${app.remote_name}" did not expose ${app.expose_key}`,
      );
    }
    return { default: module.default };
  });
  remoteComponents.set(moduleId, RemoteLazy);
  return RemoteLazy;
}

function RemoteLoading() {
  return (
    <div className="space-y-3 p-6">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

/**
 * Resolves `/platform/:appSlug/*` against the user's entitled apps (fetched +
 * registered by `loadApps`). Apps the user may not see are simply absent from
 * the store, so unknown/forbidden slugs redirect home — server-side filtering
 * is the source of truth, this is the client-side projection of it.
 */
function RemoteHost() {
  const { appSlug } = useParams();
  const { apps, loaded } = useAppsStore(
    useShallow((state) => ({ apps: state.apps, loaded: state.loaded })),
  );

  if (!loaded) return <RemoteLoading />;

  const app = apps.find((entry) => entry.id === appSlug);
  if (!app) return <Navigate to="/platform/home" replace />;

  const Remote = getRemoteComponent(app);
  return (
    <ErrorBoundary
      fallback={(props) => (
        <RemoteErrorFallback {...props} remoteName={app.remote_name} />
      )}
      onError={(error, info) => {
        console.error(`[${app.remote_name}] remote failed`, error, info);
      }}
    >
      <Suspense fallback={<RemoteLoading />}>
        <Remote />
      </Suspense>
    </ErrorBoundary>
  );
}

function RemoteErrorFallback({
  error,
  remoteName,
  resetErrorBoundary,
}: ErrorFallbackProps & { remoteName: string }) {
  return (
    <Card className="m-6 max-w-lg">
      <CardHeader>
        <CardTitle>微前端加载失败</CardTitle>
        <CardDescription>
          无法加载 <code className="text-xs">{remoteName}</code>
          。本地开发请确认对应 dev server 已启动（admin 一般为端口 3001）。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{error.message}</p>
        <Button type="button" variant="outline" onClick={resetErrorBoundary}>
          重试
        </Button>
      </CardContent>
    </Card>
  );
}

export const routes: RouteObject[] = [
  {
    path: "/",
    children: [
      {
        index: true,
        element: <Navigate to="/login" replace />,
      },
      {
        path: "404",
        lazy: lazyPage(() => import("../pages/404")),
      },
      {
        path: "login",
        lazy: lazyPage(() => import("../pages/login")),
      },
      {
        path: "register",
        lazy: lazyPage(() => import("../pages/register")),
      },
      {
        path: "platform",
        lazy: lazyPage(() => import("../pages/layout")),
        children: [
          {
            index: true,
            element: <Navigate to="/platform/home" replace />,
          },
          {
            path: "home",
            lazy: lazyPage(() => import("../pages/home")),
          },
          {
            path: "profile",
            lazy: lazyPage(() => import("../pages/profile")),
          },
          {
            path: "observability",
            lazy: lazyPage(() => import("../pages/observability")),
          },
          // Dynamic remote mount; static siblings above out-rank this.
          {
            path: ":appSlug/*",
            element: <RemoteHost />,
          },
        ],
      },
      {
        id: "fallback",
        path: "*",
        element: <Navigate to="/404" replace />,
      },
    ],
  },
];

export const router = createBrowserRouter(routes, {
  future: { v7_relativeSplatPath: true },
});
