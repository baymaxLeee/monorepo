import type { project } from "@/domain";

import type { AgentFrameService } from "./agentframe";

type ProjectReadService = Pick<AgentFrameService, "GetProject" | "GetProjectByMember" | "ListProjectsByMember">;

export function listMyProjects(
  service: ProjectReadService,
  request: project.ListProjectsByMemberRequest,
): Promise<project.ListProjectsByMemberResponse> {
  return service.ListProjectsByMember(request);
}

export function getProjectForRole(
  service: ProjectReadService,
  canManageProjects: boolean,
  request: project.GetProjectRequest,
): Promise<project.GetProjectResponse | project.GetProjectByMemberResponse> {
  return canManageProjects ? service.GetProject(request) : service.GetProjectByMember(request);
}
