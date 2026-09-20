import type { RouteObject } from "react-router-dom";
export const routes: RouteObject[] = [
  { index: true, lazy: () => import("../pages/Projects") },
  { path: "projects/:projectId", lazy: () => import("../pages/Projects") },
  { path: "projects/:projectId/resources", lazy: () => import("../pages/Resources") },
  { path: "projects/:projectId/canvases/:canvasId", lazy: () => import("../pages/Studio") },
];
