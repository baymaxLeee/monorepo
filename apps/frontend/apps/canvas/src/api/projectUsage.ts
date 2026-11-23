import { canvasAdminGetProject, canvasAdminUpdateProject, canvasCreateProject } from "@repo/api/canvas";

import type { project } from "@/domain";

export type ProjectUsageDetail = project.ProjectDetail & { UsageLimit?: number; UsedAmount?: number };
export type CreateProjectWithUsageRequest = project.CreateProjectRequest & { UsageLimit?: number };
export type UpdateProjectWithUsageRequest = project.UpdateProjectRequest & { UsageLimit?: number };

const coverUpload = (receipt?: project.CoverUpload) =>
  receipt
    ? {
        upload_session_id: receipt.UploadSessionID,
        client_ref: receipt.ClientRef,
      }
    : undefined;

const present = (value: Awaited<ReturnType<typeof canvasAdminGetProject>>["project"]): ProjectUsageDetail => ({
  ProjectID: value.project_id,
  Name: value.name,
  CoverImageAssetID: value.cover_image_asset_id,
  CoverImageRevisionID: value.cover_image_revision_id,
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
    cover_upload: coverUpload(request.CoverUpload),
    usage_limit: request.UsageLimit,
  });
  return { Project: present(response.project) };
}

export async function updateProjectWithUsage(request: UpdateProjectWithUsageRequest) {
  const response = await canvasAdminUpdateProject(request.ProjectID, {
    name: request.Name,
    member_user_ids: request.MemberUserIDs,
    cover_upload: coverUpload(request.CoverUpload),
    clear_cover_image: request.ClearCoverImage,
    usage_limit: request.UsageLimit,
  });
  return { Project: present(response.project) };
}

export async function getProjectWithUsage(request: project.GetProjectRequest) {
  return { Project: present((await canvasAdminGetProject(request.ProjectID)).project) };
}
