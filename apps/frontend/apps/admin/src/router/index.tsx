import { lazy } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { AdminLayout } from "../pages/layout";

const AppsRegistryPage = lazy(() => import("../pages/apps"));
const BotListPage = lazy(() => import("../pages/bots"));
const BotDetailPage = lazy(() => import("../pages/bots/detail"));
const ComponentsDemoPage = lazy(() => import("../pages/demo"));
const DashboardPage = lazy(() => import("../pages/dashboard"));
const KnowledgeBasePage = lazy(() => import("../pages/knowledge"));
const MembersPage = lazy(() => import("../pages/members"));
const OrganizationsPage = lazy(() => import("../pages/organizations"));
const OperationsObservabilityPage = lazy(
  () => import("../pages/observability"),
);
const TraceExplorerPage = lazy(() => import("../pages/observability/traces"));
const PlatformRolesPage = lazy(() => import("../pages/platform-roles"));
const ProfilePage = lazy(() => import("../pages/profile"));
const ProvidersPage = lazy(() => import("../pages/providers"));
const SkillsPage = lazy(() => import("../pages/skills"));
const SkillWorkspacePage = lazy(() => import("../pages/skills/workspace"));

/**
 * Mounted by platform at `/platform/admin/*`.
 * Admin owns its local shell and menu. Platform only mounts the entry route.
 */
export const routes: RouteObject[] = [
  {
    element: <AdminLayout />,
    children: [
      { index: true, element: <Navigate to="profile" replace /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "telemetry", element: <Navigate to="dashboard" replace />},
      { path: "dashboard", element: <DashboardPage /> },
      { path: "bots", element: <BotListPage /> },
      { path: "bots/:id", element: <BotDetailPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "skills/:id", element: <SkillWorkspacePage /> },
      { path: "providers", element: <ProvidersPage /> },
      { path: "knowledge", element: <KnowledgeBasePage /> },
      { path: "apps", element: <AppsRegistryPage /> },
      { path: "organizations", element: <OrganizationsPage /> },
      { path: "members", element: <MembersPage /> },
      { path: "platform-roles", element: <PlatformRolesPage /> },
      { path: "observability", element: <OperationsObservabilityPage /> },
      { path: "traces", element: <TraceExplorerPage /> },
      { path: "demo", element: <ComponentsDemoPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/404" replace /> },
];
