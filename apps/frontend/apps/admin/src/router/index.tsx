import { TooltipProvider } from "@repo/design-system";
import { Navigate, Outlet, type RouteObject } from "react-router-dom";

function AdminRoot() {
  return (
    <TooltipProvider>
      <Outlet />
    </TooltipProvider>
  );
}

export const routes: RouteObject[] = [
  {
    id: "admin-root",
    Component: AdminRoot,
    children: [
      {
        id: "admin-layout",
        lazy: () => import("../pages/layout"),
        children: [
          { index: true, element: <Navigate to="profile" replace /> },
          { path: "profile", lazy: () => import("../pages/profile") },
          {
            path: "telemetry",
            element: <Navigate to="../dashboard" replace />,
          },
          { path: "dashboard", lazy: () => import("../pages/dashboard") },
          { path: "bots", lazy: () => import("../pages/bots") },
          { path: "bots/:id", lazy: () => import("../pages/bots/detail") },
          { path: "skills", lazy: () => import("../pages/skills") },
          {
            path: "skills/:id",
            lazy: () => import("../pages/skills/workspace"),
          },
          { path: "providers", lazy: () => import("../pages/providers") },
          { path: "knowledge", lazy: () => import("../pages/knowledge") },
          { path: "apps", lazy: () => import("../pages/apps") },
          {
            path: "organizations",
            lazy: () => import("../pages/organizations"),
          },
          { path: "members", lazy: () => import("../pages/members") },
          {
            path: "platform-roles",
            lazy: () => import("../pages/platform-roles"),
          },
          {
            path: "observability",
            lazy: () => import("../pages/observability"),
          },
          {
            path: "traces",
            lazy: () => import("../pages/observability/traces"),
          },
          { path: "demo", lazy: () => import("../pages/demo") },
          { path: "*", element: <Navigate to="/404" replace /> },
        ],
      },
    ],
  },
];
