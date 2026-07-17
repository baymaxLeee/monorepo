import { loadRemote } from "@module-federation/enhanced/runtime";
import {
  createBrowserRouter,
  Navigate,
  type PatchRoutesOnNavigationFunctionArgs,
  type RouteObject,
} from "react-router-dom";
import {
  canDiscoverPlatformRoutes,
  createAppAccessMiddleware,
  guestOnlyMiddleware,
  pendingAccessMiddleware,
  platformAccessMiddleware,
  selectOrgAccessMiddleware,
} from "./access";
import { type AppEntry, loadApps, remoteModuleId } from "./app-registry";
import { RouteErrorFallback } from "./RouteErrorFallback";
import { RouteLoading } from "./RouteLoading";

type RemoteRoutesModule = { routes: RouteObject[] };

const PLATFORM_ROUTE_ID = "platform";
const PLATFORM_PREFIX = "/platform/";
const patchedRemoteIds = new Set<string>();
const remoteRoutePromises = new Map<string, Promise<RouteObject[]>>();

function normalizedBasePath(app: AppEntry): string {
  return app.base_path.replace(/\/+$/, "");
}

function relativeAppPath(app: AppEntry): string {
  const basePath = normalizedBasePath(app);
  if (!basePath.startsWith(PLATFORM_PREFIX)) {
    throw new Error(
      `App "${app.id}" base path must start with ${PLATFORM_PREFIX}`,
    );
  }
  const relativePath = basePath.slice(PLATFORM_PREFIX.length);
  if (!relativePath) {
    throw new Error(`App "${app.id}" must define a path below /platform`);
  }
  return relativePath;
}

function findAppForPath(apps: AppEntry[], path: string): AppEntry | undefined {
  return apps
    .filter((app) => app.is_enabled)
    .filter((app) => {
      const basePath = normalizedBasePath(app);
      return path === basePath || path.startsWith(`${basePath}/`);
    })
    .sort(
      (left, right) =>
        normalizedBasePath(right).length - normalizedBasePath(left).length,
    )[0];
}

function loadRemoteRoutes(app: AppEntry): Promise<RouteObject[]> {
  const cached = remoteRoutePromises.get(app.id);
  if (cached) return cached;

  const promise = loadRemote<RemoteRoutesModule>(remoteModuleId(app)).then(
    (module) => {
      if (!module || !Array.isArray(module.routes)) {
        throw new Error(
          `Remote "${app.remote_name}" did not expose a routes array at ${app.expose_key}`,
        );
      }
      return module.routes;
    },
  );
  remoteRoutePromises.set(app.id, promise);
  return promise;
}

async function discoverRemoteRoutes({
  path,
  patch,
  signal,
}: PatchRoutesOnNavigationFunctionArgs): Promise<void> {
  if (!path.startsWith(PLATFORM_PREFIX)) return;

  if (!(await canDiscoverPlatformRoutes(signal))) return;

  const apps = await loadApps();
  const app = findAppForPath(apps, path);
  if (!app || patchedRemoteIds.has(app.id)) return;

  const children = await loadRemoteRoutes(app);
  if (patchedRemoteIds.has(app.id)) return;

  patch(PLATFORM_ROUTE_ID, [
    {
      id: `remote:${app.id}`,
      path: relativeAppPath(app),
      middleware: [createAppAccessMiddleware(app)],
      errorElement: <RouteErrorFallback />,
      children,
    },
  ]);
  patchedRemoteIds.add(app.id);
}

export const routes: RouteObject[] = [
  {
    id: "root",
    path: "/",
    HydrateFallback: RouteLoading,
    errorElement: <RouteErrorFallback />,
    children: [
      {
        index: true,
        element: <Navigate to="/login" replace />,
      },
      {
        path: "404",
        lazy: () => import("../pages/404"),
      },
      {
        path: "login",
        middleware: [guestOnlyMiddleware],
        lazy: () => import("../pages/login"),
      },
      {
        path: "register",
        middleware: [guestOnlyMiddleware],
        lazy: () => import("../pages/register"),
      },
      {
        path: "pending",
        middleware: [pendingAccessMiddleware],
        lazy: () => import("../pages/pending"),
      },
      {
        path: "select-org",
        middleware: [selectOrgAccessMiddleware],
        lazy: () => import("../pages/select-org"),
      },
      {
        id: PLATFORM_ROUTE_ID,
        path: "platform",
        middleware: [platformAccessMiddleware],
        lazy: () => import("../pages/layout"),
        errorElement: <RouteErrorFallback />,
        children: [
          {
            index: true,
            element: <Navigate to="/platform/chat" replace />,
          },
          {
            path: "*",
            element: <Navigate to="/404" replace />,
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes, {
  patchRoutesOnNavigation: discoverRemoteRoutes,
});
