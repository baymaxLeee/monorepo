import { Navigate, type RouteObject } from "react-router-dom";
import { AdminLayout } from "../pages/AdminLayout";
import { AppsRegistryPage } from "../pages/AppsRegistryPage";
import { BotDetailPage } from "../pages/BotDetailPage";
import { BotListPage } from "../pages/BotListPage";
import { ComponentsDemoPage } from "../pages/ComponentsDemoPage";
import { DashboardPage } from "../pages/DashboardPage";
import { IntentionsPage } from "../pages/IntentionsPage";
import { KnowledgeBasePage } from "../pages/KnowledgeBasePage";
import { MembersPage } from "../pages/MembersPage";
import { MyTelemetryPage } from "../pages/MyTelemetryPage";
import { OrganizationsPage } from "../pages/OrganizationsPage";
import { OperationsObservabilityPage } from "../pages/observability/OperationsObservabilityPage";
import { TraceExplorerPage } from "../pages/observability/TraceExplorerPage";
import { PlatformRolesPage } from "../pages/PlatformRolesPage";
import { ProfilePage } from "../pages/ProfilePage";
import { ProvidersPage } from "../pages/ProvidersPage";
import { ScenesPage } from "../pages/ScenesPage";
import { SkillsPage } from "../pages/SkillsPage";

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
      { path: "telemetry", element: <MyTelemetryPage /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "bots", element: <BotListPage /> },
      { path: "bots/:id", element: <BotDetailPage /> },
      { path: "scenes", element: <ScenesPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "intentions", element: <IntentionsPage /> },
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
