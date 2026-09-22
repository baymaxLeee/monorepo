import { canvasAdminGetProject, canvasGetProject, canvasListProjects } from "@repo/api";

import type { project } from "@/domain";

function stats(value: { canvas_count: number; resource_count: number; selected_video_duration_millis: number }) {
  return {
    CanvasCount: value.canvas_count,
    ResourceCount: value.resource_count,
    SelectedVideoDurationMillis: value.selected_video_duration_millis,
  };
}

export async function listMyProjects(
  request: project.ListProjectsByMemberRequest,
): Promise<project.ListProjectsByMemberResponse> {
  const response = await canvasListProjects({
    keyword: request.Filter?.Keyword?.trim() || undefined,
    sort_direction: request.Sort?.Direction === 1 ? "ASC" : "DESC",
    page_num: request.Page.PageNum,
    page_size: request.Page.PageSize,
  });
  const items = response.items.map((item) => ({
    ProjectID: item.project_id,
    Name: item.name,
    CoverImagePath: item.cover_image_path,
    CoverImageURL: item.cover_image_url,
    CreatedBy: item.created_by,
    CreatedAt: item.created_at,
    UpdatedAt: item.updated_at,
    Stats: stats(item.stats),
  }));
  return {
    Items: items,
    Page: {
      Total: response.page.total,
      PageNum: response.page.page_num,
      PageSize: response.page.page_size,
      TotalPage: response.page.total_page,
    },
  };
}

export async function getProjectForRole(canManageProjects: boolean, request: project.GetProjectRequest) {
  if (canManageProjects) {
    const value = (await canvasAdminGetProject(request.ProjectID)).project;
    return {
      Project: {
        ProjectID: value.project_id,
        Name: value.name,
        CoverImagePath: value.cover_image_path,
        CoverImageURL: value.cover_image_url,
        CreatedBy: value.created_by,
        CreatedAt: value.created_at,
        UpdatedAt: value.updated_at,
        Stats: stats(value.stats),
        MemberUserIDs: value.member_user_ids,
        UsageLimit: value.usage_limit,
        UsedAmount: value.used_amount,
      },
    };
  }
  const value = (await canvasGetProject(request.ProjectID)).project;
  return {
    Project: {
      ProjectID: value.project_id,
      Name: value.name,
      CoverImagePath: value.cover_image_path,
      CoverImageURL: value.cover_image_url,
      CreatedBy: value.created_by,
      CreatedAt: value.created_at,
      UpdatedAt: value.updated_at,
      Stats: stats(value.stats),
    },
  };
}
