import { openAgentUI } from "@repo/ai-elements/agent-ui-route";
import { TooltipProvider } from "@repo/design-system";
import { Navigate, Outlet, type RouteObject } from "react-router-dom";

function ChatRoot() {
  return (
    <TooltipProvider>
      <Outlet />
    </TooltipProvider>
  );
}

export const routes: RouteObject[] = [
  {
    id: "chat-root",
    Component: ChatRoot,
    children: [
      {
        id: "chat-layout",
        lazy: () => import("../pages/layout"),
        children: [
          { path: "local/:id", lazy: () => import("../pages/local") },
          { path: "local/:id/agent-ui", loader: openAgentUI, lazy: () => import("../pages/local-agent-ui") },
          { index: true, element: <Navigate to="conversations" replace /> },
          {
            path: "conversations",
            lazy: () => import("../pages/conversations"),
          },
          {
            path: "conversations/:id",
            lazy: () => import("../pages/chat"),
          },
          {
            path: "conversations/:id/agent-ui",
            loader: openAgentUI,
            lazy: () => import("../pages/agent-ui"),
          },
          { path: "*", element: <Navigate to="/404" replace /> },
        ],
      },
    ],
  },
];
