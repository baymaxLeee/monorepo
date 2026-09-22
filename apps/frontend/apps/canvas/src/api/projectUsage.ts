import { canvasAdminGetProject, canvasAdminUpdateProject, canvasCreateProject } from "@repo/api";

import type { project } from "@/domain";

export type ProjectUsageDetail = project.ProjectDetail & { UsageLimit?: number; UsedAmount?: number };
export type CreateProjectWithUsageRequest = project.CreateProjectRequest & { UsageLimit?: number };
export type UpdateProjectWithUsageRequest = project.UpdateProjectRequest & { UsageLimit?: number };

const present = (value: Awaited<ReturnType<typeof canvasAdminGetProject>>["project"]): ProjectUsageDetail => ({
  ProjectID: value.project_id,
  Name: value.name,
  CoverImagePath: value.cover_image_path,
  CoverImageURL: value.cover_image_url,
  CreatedBy: value.created_by,
  CreatedAt: value.created_at,
  UpdatedAt: value.updated_at,
  Stats: {
    CanvasCount: value.stats.canvas_count,
    ResourceCount: value.stats.resource_count,
    SelectedVideoDurationMillis: value.stats.selected_video_duration_millis,
  },
  MemberUserIDs: value.member_user_ids,
  UsageLimit: value.usage_limit,
  UsedAmount: value.used_amount,
});

export async function createProjectWithUsage(request: CreateProjectWithUsageRequest) {
  const response = await canvasCreateProject({
    name: request.Name,
    member_user_ids: request.MemberUserIDs,
    cover_image_path: request.CoverImagePath,
    usage_limit: request.UsageLimit,
  });
  return { Project: present(response.project) };
}

export async function updateProjectWithUsage(request: UpdateProjectWithUsageRequest) {
  const response = await canvasAdminUpdateProject(request.ProjectID, {
    name: request.Name,
    member_user_ids: request.MemberUserIDs,
    cover_image_path: request.CoverImagePath,
    usage_limit: request.UsageLimit,
  });
  return { Project: present(response.project) };
}

export async function getProjectWithUsage(request: project.GetProjectRequest) {
  return { Project: present((await canvasAdminGetProject(request.ProjectID)).project) };
}
