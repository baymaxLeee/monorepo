import type { project } from "@/domain";

import { agentframeService } from "./agentframe";

export type ProjectUsageDetail = project.ProjectDetail & {
  UsageLimit?: number;
  UsedAmount?: number;
};

export type CreateProjectWithUsageRequest = project.CreateProjectRequest & {
  UsageLimit?: number;
};

export type UpdateProjectWithUsageRequest = project.UpdateProjectRequest & {
  UsageLimit?: number;
};

type ProjectUsageService = {
  CreateProject(request: CreateProjectWithUsageRequest): Promise<{ Project: ProjectUsageDetail }>;
  UpdateProject(request: UpdateProjectWithUsageRequest): Promise<{ Project: ProjectUsageDetail }>;
  GetProject(request: project.GetProjectRequest): Promise<{ Project: ProjectUsageDetail }>;
};

const usageService = agentframeService as unknown as ProjectUsageService;

export const createProjectWithUsage = (request: CreateProjectWithUsageRequest) => usageService.CreateProject(request);

export const updateProjectWithUsage = (request: UpdateProjectWithUsageRequest) => usageService.UpdateProject(request);

export const getProjectWithUsage = (request: project.GetProjectRequest) => usageService.GetProject(request);
