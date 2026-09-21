import { type RouteObject, Navigate } from "react-router-dom";

import { App } from "../App";
export const routes: RouteObject[] = [
  {
    element: <App />,
    children: [
      { index: true, element: <Navigate replace to="projects" /> },
      {
        path: "help",
        lazy: async () => ({ Component: (await import("../pages/help")).default }),
      },
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
        lazy: async () => ({ Component: (await import("../pages/studio")).default }),
      },
      {
        path: "projects/:projectId/canvases/:canvasId",
        lazy: async () => ({ Component: (await import("../pages/studio")).default }),
      },
      { path: "*", element: <Navigate replace to="projects" /> },
    ],
  },
];
