import { useEffect, useState, type ComponentType } from "react";
import { Navigate, Outlet, useRoutes, type RouteObject } from "react-router-dom";
import { bootstrapSession } from "@packages/api";
import { Lazy, Muted, Skeleton } from "@packages/components";
import { usePlatformStore } from "@packages/runtime";
import { Layout } from "../components/Layout";
import { RemoteErrorBoundary } from "../components/RemoteErrorBoundary";
import { registry } from "../registry";

type RouteLoader = () => Promise<{ default: ComponentType }>;

const remoteAppLoaders = {
  mfe_admin: () => import("mfe_admin/App"),
} satisfies Record<string, RouteLoader>;

const remoteRoutes: RouteObject[] = registry.flatMap((m) => {
  const loader =
    remoteAppLoaders[m.remoteName as keyof typeof remoteAppLoaders];
  if (!loader) return [];

  return [
    {
      path: `${m.id}/*`,
      element: (
        <RemoteErrorBoundary remoteName={m.remoteName}>
          <Lazy loader={loader} />
        </RemoteErrorBoundary>
      ),
    },
  ];
});

export const routers: RouteObject[] = [
  {
    path: "/404",
    element: <Lazy loader={() => import("../pages/404")} />,
  },
  {
    path: "/login",
    element: <Lazy loader={() => import("../pages/login")} />,
  },
  {
    path: "/register",
    element: <Lazy loader={() => import("../pages/register")} />,
  },
  {
    path: "/platform",
    element: <PlatformLayoutRoute />,
    children: [
      {
        index: true,
        element: <Navigate to="/platform/home" replace />,
      },
      {
        path: "home",
        element: <Lazy loader={() => import("../pages/home")} />,
      },
      {
        path: "profile",
        element: <Lazy loader={() => import("../pages/profile")} />,
      },
      ...remoteRoutes,
    ],
  },
  {
    id: "fallback",
    path: "*",
    element: <AuthAwareFallback />,
  },
];

function SessionLoadingFallback() {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <div className="w-full max-w-xs space-y-3">
        <Skeleton className="h-8 w-32 animate-pulse" />
        <Skeleton className="h-4 w-full animate-pulse" />
        <Muted>正在恢复会话…</Muted>
      </div>
    </div>
  );
}

function PlatformLayoutRoute() {
  const user = usePlatformStore((state) => state.user);
  const setUser = usePlatformStore((state) => state.setUser);

  if (!user) return <Navigate to="/login" replace />;

  return (
    <Layout user={user} onUserChanged={setUser}>
      <Outlet />
    </Layout>
  );
}

function AuthAwareFallback() {
  return <Navigate to="/404" replace />;
}

export function AppRouter() {
  const element = useRoutes(routers);
  const setUser = usePlatformStore((state) => state.setUser);
  const setMenus = usePlatformStore((state) => state.setMenus);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setMenus(
      registry.map((m) => ({
        id: m.id,
        title: m.title,
        basePath: m.basePath,
        subNav: m.subNav,
      })),
    );
  }, [setMenus]);

  useEffect(() => {
    let alive = true;
    bootstrapSession()
      .then((sessionUser) => {
        if (alive) setUser(sessionUser);
      })
      .catch(() => {
        if (alive) setUser(null);
      })
      .finally(() => {
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [setUser]);

  if (!ready) {
    return <SessionLoadingFallback />;
  }

  return element;
}
