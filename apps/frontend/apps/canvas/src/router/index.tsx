import { openAgentUI } from "@repo/ai-elements/agent-ui-route";
import { type RouteObject, Navigate } from "react-router-dom";

import { App } from "../App";
export const routes: RouteObject[] = [
  {
    element: <App />,
    children: [
      { index: true, element: <Navigate replace to="projects" /> },
      {
        path: "projects",
        lazy: async () => ({ Component: (await import("../pages/projects")).default }),
      },
      {
        path: "projects/:projectId",
        lazy: async () => ({ Component: (await import("../pages/projectLayout")).default }),
        children: [
          { index: true, element: <Navigate replace to="canvases" /> },
          {
            path: "canvases",
            lazy: async () => ({ Component: (await import("../pages/canvases")).default }),
          },
          {
            path: "resources",
            lazy: async () => ({ Component: (await import("../pages/resources")).default }),
          },
        ],
      },
      {
        path: "projects/:projectId/studio/:canvasId",
        loader: openAgentUI,
        lazy: async () => ({ Component: (await import("../pages/studio")).default }),
      },
      {
        path: "projects/:projectId/canvases/:canvasId",
        loader: openAgentUI,
        lazy: async () => ({ Component: (await import("../pages/studio")).default }),
      },
      { path: "*", element: <Navigate replace to="projects" /> },
    ],
  },
];
