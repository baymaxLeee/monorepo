import { usePlatformStore } from "@repo/runtime";

export const AGENTFRAME_RESOURCES = {
  projectManagement: "project-management",
  basicConfig: "basic-config",
  presetBenefitPackage: "preset-benefit-package",
  customBenefitPackage: "custom-benefit-package",
} as const;

export type AgentFrameResource = (typeof AGENTFRAME_RESOURCES)[keyof typeof AGENTFRAME_RESOURCES];

export function useAgentFrameResource(_resource: AgentFrameResource, _scope: "member" | "tenant") {
  const user = usePlatformStore((state) => state.user);
  return {
    ready: true,
    allowed: user?.activeWorkspace?.role === "workspace_admin",
  };
}
