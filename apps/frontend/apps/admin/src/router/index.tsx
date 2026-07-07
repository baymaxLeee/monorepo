import { Navigate, type RouteObject } from "react-router-dom";
import { AdminLayout } from "../pages/AdminLayout";
import { AppsRegistryPage } from "../pages/AppsRegistryPage";
import { BotDetailPage } from "../pages/BotDetailPage";
import { BotListPage } from "../pages/BotListPage";
import { ComponentsDemoPage } from "../pages/ComponentsDemoPage";
import { IntentionsPage } from "../pages/IntentionsPage";
import { KnowledgeBasePage } from "../pages/KnowledgeBasePage";
import { MembersPage } from "../pages/MembersPage";
import { OrganizationsPage } from "../pages/OrganizationsPage";
import { OperationsObservabilityPage } from "../pages/observability/OperationsObservabilityPage";
import { PlatformRolesPage } from "../pages/PlatformRolesPage";
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
      { index: true, element: <Navigate to="bots" replace /> },
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
      { path: "demo", element: <ComponentsDemoPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/404" replace /> },
];
