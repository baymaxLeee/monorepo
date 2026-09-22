import { usePlatformStore } from "@repo/runtime";

export function useCanManageProjects() {
  return usePlatformStore((state) => state.user?.activeWorkspace?.role === "workspace_admin");
}
