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
} from "components";
import type { ComponentType } from "react";
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from "react-router-dom";
import { registry } from "../registry";

type RouteLoader = LazyLoader<object>;

function lazyPage(loader: RouteLoader): RouteObject["lazy"] {
  return async () => {
    const module = await loader();
    return { Component: module.default as ComponentType };
  };
}

function lazyRemote(
  remoteName: string,
  loader: RouteLoader,
): RouteObject["lazy"] {
  return async () => {
    const module = await loader();
    const RemoteApp = module.default as ComponentType;

    function RemoteRoute() {
      return (
        <ErrorBoundary
          fallback={(props) => (
            <RemoteErrorFallback {...props} remoteName={remoteName} />
          )}
          onError={(error, info) => {
            console.error(`[${remoteName}] remote failed`, error, info);
          }}
        >
          <RemoteApp />
        </ErrorBoundary>
      );
    }

    return { Component: RemoteRoute };
  };
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

const remoteAppLoaders = {
  mfe_admin: () => import("mfe_admin/App"),
  mfe_chat: () => import("mfe_chat/App"),
} satisfies Record<string, RouteLoader>;

const remoteRoutes: RouteObject[] = registry.flatMap((m) => {
  const loader =
    remoteAppLoaders[m.remoteName as keyof typeof remoteAppLoaders];
  if (!loader) return [];

  return [
    {
      path: `${m.id}/*`,
      lazy: lazyRemote(m.remoteName, loader),
    },
  ];
});

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
          ...remoteRoutes,
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
