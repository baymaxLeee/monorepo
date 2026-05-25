import { Navigate, type RouteObject } from "react-router-dom";
import { AdminLayout } from "../pages/AdminLayout";
import { BotDetailPage } from "../pages/BotDetailPage";
import { BotListPage } from "../pages/BotListPage";
import { ComponentsDemoPage } from "../pages/ComponentsDemoPage";
import { IntentionsPage } from "../pages/IntentionsPage";
import { OperationsObservabilityPage } from "../pages/observability/OperationsObservabilityPage";
import { ScenesPage } from "../pages/ScenesPage";

/**
 * Mounted by platform at `/platform/admin/*`.
 * Admin owns its local shell and menu. Platform only mounts the entry route.
 */
export const routes: RouteObject[] = [
  {
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to="bots" replace /> },
      { path: "bots", element: <BotListPage /> },
      { path: "bots/:id", element: <BotDetailPage /> },
      { path: "scenes", element: <ScenesPage /> },
      { path: "intentions", element: <IntentionsPage /> },
      { path: "observability", element: <OperationsObservabilityPage /> },
      { path: "demo", element: <ComponentsDemoPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/404" replace /> },
];
