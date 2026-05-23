import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import {
  Navigate,
  Outlet,
  useLocation,
  useRoutes,
  type RouteObject,
} from "react-router-dom";
import { bootstrapSession } from "@packages/api";
import { LazyRoute, Muted, Skeleton } from "@packages/components";
import { usePlatformStore } from "@packages/runtime";
import { Layout } from "../components/Layout";
import { RemoteErrorBoundary } from "../components/RemoteErrorBoundary";
import {
  defaultAppPath,
  HOME_PATH,
  LOGIN_PATH,
  NOT_FOUND_PATH,
  PROFILE_PATH,
  REGISTER_PATH,
  registry,
} from "../registry";

type RouteLoader = () => Promise<{ default: ComponentType }>;
type AccessMode = "public" | "guest" | "auth";

export type RegisteredRoute = {
  id: string;
  path?: string;
  title: string;
  access: AccessMode;
  component: string;
  element: ReactNode;
  children?: RegisteredRoute[];
};

const remoteAppLoaders = {
  mfe_admin: () => import("mfe_admin/App"),
} satisfies Record<string, RouteLoader>;

const remoteRoutes: RegisteredRoute[] = registry.flatMap((m) => {
  const loader =
    remoteAppLoaders[m.remoteName as keyof typeof remoteAppLoaders];
  if (!loader) return [];

  return [
    {
      id: m.id,
      path: `${m.basePath}/*`,
      title: m.title,
      access: "auth",
      component: m.remoteName,
      element: (
        <RemoteErrorBoundary remoteName={m.remoteName}>
          <LazyRoute loader={loader} />
        </RemoteErrorBoundary>
      ),
    },
  ];
});

export const routerList: RegisteredRoute[] = [
  {
    id: "not-found",
    path: NOT_FOUND_PATH,
    title: "404",
    access: "public",
    component: "NotFoundPage",
    element: <LazyRoute loader={() => import("../pages/404")} />,
  },
  {
    id: "guest",
    title: "Guest routes",
    access: "guest",
    component: "GuestOnlyRoute",
    element: <GuestOnlyRoute />,
    children: [
      {
        id: "login",
        path: LOGIN_PATH,
        title: "登录",
        access: "guest",
        component: "LoginPage",
        element: <LazyRoute loader={() => import("../pages/login")} />,
      },
      {
        id: "register",
        path: REGISTER_PATH,
        title: "注册账号",
        access: "guest",
        component: "RegisterPage",
        element: <LazyRoute loader={() => import("../pages/register")} />,
      },
    ],
  },
  {
    id: "auth",
    title: "Authenticated routes",
    access: "auth",
    component: "RequireAuth",
    element: <RequireAuth />,
    children: [
      {
        id: "platform-layout",
        title: "Platform shell",
        access: "auth",
        component: "Layout",
        element: <PlatformLayoutRoute />,
        children: [
          {
            id: "home",
            path: HOME_PATH,
            title: "首页",
            access: "auth",
            component: "HomePage",
            element: <LazyRoute loader={() => import("../pages/home")} />,
          },
          {
            id: "profile",
            path: PROFILE_PATH,
            title: "个人资料",
            access: "auth",
            component: "ProfilePage",
            element: <LazyRoute loader={() => import("../pages/profile")} />,
          },
          ...remoteRoutes,
        ],
      },
    ],
  },
  {
    id: "fallback",
    path: "*",
    title: "Fallback redirect",
    access: "public",
    component: "AuthAwareFallback",
    element: <AuthAwareFallback />,
  },
];

const routeObjects = routerList.map(toRouteObject);

function toRouteObject(route: RegisteredRoute): RouteObject {
  return {
    path: route.path,
    element: route.element,
    children: route.children?.map(toRouteObject),
  };
}

function isPublicAuthPath(pathname: string) {
  return (
    pathname === LOGIN_PATH ||
    pathname === `${LOGIN_PATH}/` ||
    pathname === REGISTER_PATH ||
    pathname === `${REGISTER_PATH}/` ||
    pathname === NOT_FOUND_PATH ||
    pathname === `${NOT_FOUND_PATH}/`
  );
}

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

function GuestOnlyRoute() {
  const user = usePlatformStore((state) => state.user);
  return user ? <Navigate to={defaultAppPath} replace /> : <Outlet />;
}

function RequireAuth() {
  const user = usePlatformStore((state) => state.user);
  return user ? <Outlet /> : <Navigate to={LOGIN_PATH} replace />;
}

function PlatformLayoutRoute() {
  const user = usePlatformStore((state) => state.user);
  const setUser = usePlatformStore((state) => state.setUser);

  if (!user) return <Navigate to={LOGIN_PATH} replace />;

  return (
    <Layout user={user} onUserChanged={setUser}>
      <Outlet />
    </Layout>
  );
}

function AuthAwareFallback() {
  return <Navigate to={NOT_FOUND_PATH} replace />;
}

export function AppRouter() {
  const location = useLocation();
  const element = useRoutes(routeObjects);
  const setUser = usePlatformStore((state) => state.setUser);
  const setMenus = usePlatformStore((state) => state.setMenus);
  const [ready, setReady] = useState(false);
  const onPublicAuthRoute = isPublicAuthPath(location.pathname);

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
    if (onPublicAuthRoute) {
      return <LazyRoute loader={() => import("../pages/login")} />;
    }
    return <SessionLoadingFallback />;
  }

  return element;
}
