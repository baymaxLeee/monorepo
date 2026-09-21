import { AGENTFRAME_RESOURCES, useAgentFrameResource } from "./useAgentFrameResource";

export function useCanManageProjects() {
  return useAgentFrameResource(AGENTFRAME_RESOURCES.projectManagement, "member").allowed;
}
