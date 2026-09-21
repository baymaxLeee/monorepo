import {
  canvasCancelResourceGeneration,
  canvasClearBoardCover,
  canvasClearProjectCover,
  canvasCreateBoard,
  canvasCreateGeneratedResourceAsset,
  canvasCreateProject,
  canvasCreateResource,
  canvasDeleteBoard,
  canvasDeleteProject,
  canvasDeleteResource,
  canvasDeleteResourceAsset,
  canvasGetGraph,
  canvasGetProject,
  canvasGetResourceGeneration,
  canvasListAssetReviews,
  canvasListAvailableBenefitPackages,
  canvasListBoards,
  canvasListProjects,
  canvasListResourceAssets,
  canvasListResourceGenerationRuns,
  canvasListResources,
  canvasProjectManagement,
  fetchModelProviders,
  canvasResourceFromNode,
  canvasSearchCreativeAssets,
  canvasReplaceResourceAsset,
  canvasSetPrimaryResourceAsset,
  canvasStartResourceGeneration,
  canvasSubmitAssetReview,
  canvasSubmitProjectAssetReview,
  canvasUpdateBoard,
  canvasUpdateCanvasView,
  canvasUpdateProject,
  canvasUpdateProjectMembers,
  canvasUpdateProjectUsageLimit,
  canvasUpdateResource,
  canvasUpdateResourceAsset,
  canvasUpdateResourceGeneration,
  canvasUploadResourceAsset,
  canvasUploadBoardCover,
  canvasUploadProjectAsset,
  canvasUploadProjectCover,
  type ApiRequestConfig,
  type CanvasAssetReview,
  type CanvasBoard,
  type CanvasGeneration,
  type ModelProvider,
  type CanvasProject,
  type CanvasProjectSummary as CanvasProjectListItem,
  type CanvasResource,
  type CanvasResourceAsset,
  type CanvasResourceGenerationDraft,
} from "@repo/api";

import { type project, asset, benefit_package, type canvas, resource, canvasnode } from "@/domain";
import { completeUpload, selectedUpload } from "@/hooks/uploads";
import {
  BatchGetCanvasNodeStates,
  CancelCanvasNodeGeneration,
  ListCanvasNodeHistories,
  SelectCanvasNodeHistory,
  StartCanvasGeneration,
  StartCanvasNodeGeneration,
} from "@/pages/studio/domain/generations";
import {
  ConnectCanvasNodes,
  CreateCanvasNode,
  DeleteCanvasNode,
  UpdateCanvasNode,
} from "@/pages/studio/domain/persistence";

export type TApiRequestConfig = ApiRequestConfig;

const page = (total: number, pageNum = 1, pageSize = Math.max(total, 1)) => ({
  Total: total,
  PageNum: pageNum,
  PageSize: pageSize,
  TotalPage: Math.ceil(total / pageSize),
});

const projectAssetContentURL = (projectId: string, assetId: string) =>
  `/api/canvas-server/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/content`;

async function projectStats(projectId: string): Promise<project.ProjectStats> {
  const [boards, resources] = await Promise.all([canvasListBoards(projectId), canvasListResources(projectId)]);
  const graphs = await Promise.all(boards.items.map((board) => canvasGetGraph(board.id)));
  return {
    CanvasCount: boards.items.length,
    ResourceCount: resources.items.length,
    SelectedVideoDurationMillis:
      graphs.reduce(
        (total, graph) =>
          total + graph.nodes.reduce((duration, node) => duration + (node.generation_config.duration_seconds || 0), 0),
        0,
      ) * 1000,
  };
}

function projectSummary(value: CanvasProject, stats: project.ProjectStats): project.ProjectSummary {
  return {
    ProjectID: value.id,
    Name: value.name,
    CoverImagePath: value.cover_image_path || undefined,
    CreatedBy: value.created_by,
    CreatedAt: value.created_at,
    UpdatedAt: value.updated_at,
    MemberUserIDs: [],
    Stats: stats,
  };
}

function toListedProjectSummary(value: CanvasProjectListItem): project.ProjectSummary {
  return projectSummary(value, {
    CanvasCount: value.stats.canvas_count,
    ResourceCount: value.stats.resource_count,
    SelectedVideoDurationMillis: value.stats.selected_video_duration_millis,
  });
}

async function toProjectDetail(value: CanvasProject): Promise<project.ProjectDetail> {
  const management = await canvasProjectManagement(value.id);
  return {
    ...projectSummary(value, await projectStats(value.id)),
    MemberUserIDs: management.members.map((member) => member.user_id),
    UsageLimit: management.usage_limit_micros == null ? undefined : management.usage_limit_micros / 1_000_000,
    UsedAmount: management.used_amount_micros / 1_000_000,
  };
}

async function toCanvasSummary(value: CanvasBoard): Promise<canvas.ProjectCanvasSummary> {
  const graph = await canvasGetGraph(value.id);
  const durationSeconds = graph.nodes.reduce(
    (total, node) => total + (node.generation_config.duration_seconds || 0),
    0,
  );
  return {
    CanvasID: value.id,
    ProjectID: value.project_id,
    Name: value.name,
    CoverImagePath: value.cover_image_path || undefined,
    CreatedBy: value.created_by,
    CreatedAt: value.created_at,
    UpdatedAt: value.updated_at,
    Stats: { CanvasNodeCount: graph.nodes.length, SelectedVideoDurationMillis: durationSeconds * 1000 },
    DefaultView: value.default_view as canvas.CanvasViewMode,
    Revision: value.revision,
  };
}

const reviewStatus: Record<string, asset.AssetReviewStatus> = {
  submitting: asset.AssetReviewStatus.SUBMITTING,
  processing: asset.AssetReviewStatus.PROCESSING,
  approved: asset.AssetReviewStatus.APPROVED,
  failed: asset.AssetReviewStatus.FAILED,
};

function providerModelType(kind: ModelProvider["provider_kind"]): string {
  if (kind === "chat") return "text-generation";
  if (kind === "image" || kind === "video") return "vision";
  return kind;
}

function providerModelFeatures(provider: ModelProvider): string[] {
  if (provider.provider_kind === "chat") return ["tool-call"];
  if (provider.provider_kind === "image") {
    return ["text2image", ...(provider.supports_image_input ? ["image2image"] : [])];
  }
  if (provider.provider_kind === "video") {
    return ["text2video", ...(provider.supports_image_input ? ["image2video"] : [])];
  }
  return [];
}

/**
 * The current provider directory does not expose AIGW's model-level generation
 * capabilities yet. Keep the compatibility contract in this adapter so the
 * copied AgentFrame UI can continue to render from ProjectModelInfo.Property.
 *
 * The fallback is a conservative subset of canvas-server's accepted video
 * payload. Replace it once the provider directory starts returning per-model
 * capability metadata; callers must not grow another independent set of UI
 * defaults.
 */
function providerModelProperty(provider: ModelProvider): project.ProjectModelProperty | undefined {
  if (provider.provider_kind !== "video") return undefined;
  return {
    Vision: {
      Video: {
        Duration: {
          Min: 5,
          Max: 10,
          Default: 5,
          Recommends: [5],
          RecommendDefault: 5,
        },
        Ratio: {
          Values: ["16:9", "4:3", "1:1", "3:4", "9:16"],
          Adaptive: true,
          Default: "16:9",
        },
        Resolutions: ["720P", "1080P", "480P"],
        GenerateAudio: {
          Types: ["disabled", "enabled"],
          Default: "disabled",
        },
        Watermark: {
          Supported: true,
          Enabled: false,
        },
        Reference: {
          Image: {
            Supported: provider.supports_image_input,
            Max: provider.supports_image_input ? 2 : 0,
          },
          Video: { Supported: false, Max: 0 },
          Audio: { Supported: false, Max: 0 },
        },
      },
    },
  };
}

function toReview(value: CanvasAssetReview): asset.AssetReview {
  return {
    PackageID: value.benefit_package_id,
    PackageName: value.package_name,
    Status: reviewStatus[value.status.toLowerCase()] ?? asset.AssetReviewStatus.PROCESSING,
    FailureReason: value.failure_reason || undefined,
    SubmittedAt: value.submitted_at || undefined,
    UpdatedAt: value.updated_at,
  };
}

async function toResource(
  value: CanvasResource,
  providedReviews?: Map<string, asset.AssetReview[]>,
): Promise<resource.Resource> {
  const assets = await canvasListResourceAssets(value.project_id, value.id);
  const reviewMap = providedReviews ?? (await reviewsByAsset(value.project_id));
  const primary = assets.items.find((item) => item.id === value.primary_resource_asset_id);
  return {
    ResourceID: value.id,
    ProjectID: value.project_id,
    Type: value.type,
    Name: value.name,
    Description: value.description,
    PrimaryResourceAsset: primary
      ? {
          ResourceAssetID: primary.id,
          Name: primary.name,
          CurrentAssetID: primary.current_asset_id || undefined,
          PreviewURL: primary.preview_url || undefined,
          MediaType: primary.media_type,
          SourceType: primary.source_type,
        }
      : undefined,
    ResourceAssetCount: value.resource_asset_count,
    Revision: value.revision,
    CreatedBy: value.created_by,
    CreatedAt: value.created_at,
    UpdatedAt: value.updated_at,
    OwnerType: resource.ResourceOwnerType.PROJECT,
    ApprovedResourceAssetCount: assets.items.filter((item) =>
      reviewMap.get(item.id)?.some((review) => review.Status === asset.AssetReviewStatus.APPROVED),
    ).length,
  };
}

async function reviewsByAsset(projectId: string) {
  const response = await canvasListAssetReviews(projectId);
  return response.items.reduce<Map<string, asset.AssetReview[]>>((grouped, review) => {
    const mapped = toReview(review);
    for (const key of new Set([review.asset_id, review.resource_asset_id].filter(Boolean))) {
      const items = grouped.get(key) ?? [];
      items.push(mapped);
      grouped.set(key, items);
    }
    return grouped;
  }, new Map());
}

function toGenerationRun(value: CanvasGeneration): resource.ResourceAssetGenerationRun {
  const status: Record<string, resource.ResourceAssetGenerationRunStatus> = {
    queued: resource.ResourceAssetGenerationRunStatus.QUEUED,
    running: resource.ResourceAssetGenerationRunStatus.RUNNING,
    succeeded: resource.ResourceAssetGenerationRunStatus.SUCCEEDED,
    failed: resource.ResourceAssetGenerationRunStatus.FAILED,
    cancelled: resource.ResourceAssetGenerationRunStatus.CANCELLED,
  };
  return {
    TaskRunID: value.id,
    Status: status[value.status.toLowerCase()] ?? resource.ResourceAssetGenerationRunStatus.FAILED,
    Prompt: value.prompt,
    ModelID: value.provider_id,
    Resolution: resource.ResourceAssetGenerationResolution.RESOLUTION_720P,
    AspectRatio: resource.ResourceAssetGenerationAspectRatio.RATIO_16_9,
    Watermark: false,
    Inputs: [],
    OutputAssetID: value.output_asset_id || undefined,
    ErrorMessage: value.error || undefined,
    CreatedAt: value.created_at,
    UpdatedAt: value.updated_at,
  };
}

function toGeneration(
  projectId: string,
  resourceId: string,
  value: CanvasResourceGenerationDraft,
): resource.ResourceAssetGeneration {
  return {
    Prompt: value.config.prompt,
    ModelID: value.config.provider_id,
    Resolution: undefined,
    AspectRatio: undefined,
    Watermark: value.config.watermark,
    UploadedReferences: value.config.uploaded_asset_ids.map((assetId, index) => ({
      AssetID: assetId,
      FileName: `参考图 ${index + 1}`,
      PreviewURL: projectAssetContentURL(projectId, assetId),
    })),
    ResourceReferences: value.config.reference_sequences.map((sequence) => ({
      ResourceID: resourceId,
      SequenceNo: sequence,
    })),
    Revision: value.revision,
    ActiveTaskRunID: value.active_run_id || undefined,
  };
}

async function toResourceAsset(
  projectId: string,
  resourceId: string,
  value: CanvasResourceAsset,
  primaryId?: string,
  reviewMap?: Map<string, asset.AssetReview[]>,
) {
  const reviews = reviewMap ?? (await reviewsByAsset(projectId));
  return {
    ResourceAssetID: value.id,
    ResourceID: resourceId,
    Name: value.name,
    SequenceNo: value.sequence_no,
    CurrentAssetID: value.current_asset_id || undefined,
    PreviewURL: value.preview_url || undefined,
    ExpiresAt: value.expires_at || undefined,
    IsPrimary: value.id === primaryId,
    Revision: value.revision,
    CreatedAt: value.created_at,
    UpdatedAt: value.updated_at,
    MediaType: value.media_type,
    SourceType: value.source_type,
    Reviews: reviews.get(value.id),
  } satisfies resource.ResourceAsset;
}

async function uploadSelection(projectId: string, resourceId: string, assetId: string, blobId: string, name: string) {
  const selection = selectedUpload(blobId);
  return canvasUploadResourceAsset(projectId, resourceId, assetId, selection.file, { name });
}

const isSelectedCover = (value?: string) => value?.startsWith("data:") ?? false;

async function selectedCoverBlob(value: string) {
  const response = await fetch(value);
  if (!response.ok) throw new Error("封面读取失败，请重新选择");
  return response.blob();
}

export const agentframeService = {
  async ListProjectsByMember(
    request: project.ListProjectsByMemberRequest,
  ): Promise<project.ListProjectsByMemberResponse> {
    const response = await canvasListProjects();
    const keyword = request.Filter?.Keyword?.trim().toLocaleLowerCase();
    const items = response.items.map(toListedProjectSummary);
    const filtered = keyword ? items.filter((item) => item.Name.toLocaleLowerCase().includes(keyword)) : items;
    if (request.Sort?.Direction === 1) filtered.sort((a, b) => a.UpdatedAt.localeCompare(b.UpdatedAt));
    else filtered.sort((a, b) => b.UpdatedAt.localeCompare(a.UpdatedAt));
    const start = (request.Page.PageNum - 1) * request.Page.PageSize;
    return {
      Items: filtered.slice(start, start + request.Page.PageSize),
      Page: page(filtered.length, request.Page.PageNum, request.Page.PageSize),
    };
  },
  async GetProject(request: project.GetProjectRequest): Promise<project.GetProjectResponse> {
    return { Project: await toProjectDetail(await canvasGetProject(request.ProjectID)) };
  },
  async GetProjectByMember(request: project.GetProjectByMemberRequest): Promise<project.GetProjectByMemberResponse> {
    const value = await toProjectDetail(await canvasGetProject(request.ProjectID));
    return { Project: value };
  },
  async CreateProject(request: project.CreateProjectRequest): Promise<project.CreateProjectResponse> {
    let created = await canvasCreateProject({
      name: request.Name,
      description: "",
      member_user_ids: request.MemberUserIDs,
      usage_limit_micros: request.UsageLimit == null ? null : request.UsageLimit * 1_000_000,
    });
    if (request.CoverImagePath && isSelectedCover(request.CoverImagePath)) {
      created = await canvasUploadProjectCover(created.id, await selectedCoverBlob(request.CoverImagePath), {
        expected_revision: created.revision,
      });
    }
    return { Project: await toProjectDetail(created) };
  },
  async UpdateProject(request: project.UpdateProjectRequest): Promise<project.UpdateProjectResponse> {
    const management = await canvasProjectManagement(request.ProjectID);
    const previousCover = management.project.cover_image_path;
    let updated = await canvasUpdateProject(request.ProjectID, {
      name: request.Name,
      description: management.project.description,
      expected_revision: management.project.revision,
    });
    if (isSelectedCover(request.CoverImagePath)) {
      updated = await canvasUploadProjectCover(request.ProjectID, await selectedCoverBlob(request.CoverImagePath!), {
        expected_revision: updated.revision,
      });
    } else if (request.CoverImagePath === "" && previousCover) {
      updated = await canvasClearProjectCover(request.ProjectID, { expected_revision: updated.revision });
    }
    let current = await canvasProjectManagement(request.ProjectID);
    const existingRoles = new Map(current.members.map((member) => [member.user_id, member.role]));
    current = await canvasUpdateProjectMembers(request.ProjectID, {
      expected_revision: current.project.revision,
      members: request.MemberUserIDs.filter((userId) => userId !== current.project.created_by).map((userId) => ({
        user_id: userId,
        role: existingRoles.get(userId) ?? "editor",
      })),
    });
    current = await canvasUpdateProjectUsageLimit(request.ProjectID, {
      expected_revision: current.project.revision,
      usage_limit_micros: request.UsageLimit == null ? null : request.UsageLimit * 1_000_000,
    });
    updated = current.project;
    return { Project: await toProjectDetail(updated) };
  },
  async UpdateProjectByMember(
    request: project.UpdateProjectByMemberRequest,
  ): Promise<project.UpdateProjectByMemberResponse> {
    const current = await canvasGetProject(request.ProjectID);
    let value = current;
    if (isSelectedCover(request.CoverImagePath)) {
      value = await canvasUploadProjectCover(request.ProjectID, await selectedCoverBlob(request.CoverImagePath!), {
        expected_revision: current.revision,
      });
    } else if (request.CoverImagePath === "" && current.cover_image_path) {
      value = await canvasClearProjectCover(request.ProjectID, { expected_revision: current.revision });
    }
    return { Project: await toProjectDetail(value) };
  },
  async DeleteProject(request: project.DeleteProjectRequest) {
    const value = await canvasGetProject(request.ProjectID);
    return canvasDeleteProject(request.ProjectID, { expected_revision: value.revision });
  },
  async ListProjectCanvases(request: canvas.ListProjectCanvasesRequest): Promise<canvas.ListProjectCanvasesResponse> {
    const response = await canvasListBoards(
      request.ProjectID,
      request.Filter?.CreatedByMe ? { created_by_me: true } : undefined,
    );
    const items = await Promise.all(response.items.map(toCanvasSummary));
    const keyword = request.Filter?.Keyword?.trim().toLocaleLowerCase();
    const filtered = keyword ? items.filter((item) => item.Name.toLocaleLowerCase().includes(keyword)) : items;
    if (request.Sort?.Direction === 1) filtered.sort((a, b) => a.UpdatedAt.localeCompare(b.UpdatedAt));
    else filtered.sort((a, b) => b.UpdatedAt.localeCompare(a.UpdatedAt));
    const start = (request.Page.PageNum - 1) * request.Page.PageSize;
    return {
      Items: filtered.slice(start, start + request.Page.PageSize),
      Page: page(filtered.length, request.Page.PageNum, request.Page.PageSize),
    };
  },
  async CreateProjectCanvas(request: canvas.CreateProjectCanvasRequest): Promise<canvas.CreateProjectCanvasResponse> {
    let created = await canvasCreateBoard(request.ProjectID, { name: request.Name });
    if (request.CoverImagePath && isSelectedCover(request.CoverImagePath)) {
      created = await canvasUploadBoardCover(created.id, await selectedCoverBlob(request.CoverImagePath), {
        expected_revision: created.revision,
      });
    }
    return { Canvas: await toCanvasSummary(created) };
  },
  async UpdateProjectCanvas(request: canvas.UpdateProjectCanvasRequest): Promise<canvas.UpdateProjectCanvasResponse> {
    const board = (await canvasListBoards(request.ProjectID)).items.find((item) => item.id === request.CanvasID);
    if (!board) throw new Error("剧集不存在");
    let updated = await canvasUpdateBoard(request.CanvasID, { name: request.Name, expected_revision: board.revision });
    if (isSelectedCover(request.CoverImagePath)) {
      updated = await canvasUploadBoardCover(request.CanvasID, await selectedCoverBlob(request.CoverImagePath!), {
        expected_revision: updated.revision,
      });
    } else if (request.CoverImagePath === "" && board.cover_image_path) {
      updated = await canvasClearBoardCover(request.CanvasID, { expected_revision: updated.revision });
    }
    return { Canvas: await toCanvasSummary(updated) };
  },
  async GetProjectCanvas(request: canvas.GetProjectCanvasRequest): Promise<canvas.GetProjectCanvasResponse> {
    const board = (await canvasListBoards(request.ProjectID)).items.find((item) => item.id === request.CanvasID);
    if (!board) throw new Error("剧集不存在");
    return { Canvas: await toCanvasSummary(board) };
  },
  async DeleteProjectCanvas(request: canvas.DeleteProjectCanvasRequest) {
    const board = (await canvasListBoards(request.ProjectID)).items.find((item) => item.id === request.CanvasID);
    if (!board) return { deleted: true };
    return canvasDeleteBoard(request.CanvasID, { expected_revision: board.revision });
  },
  async ListResources(request: resource.ListResourcesRequest): Promise<resource.ListResourcesResponse> {
    const [response, reviewMap] = await Promise.all([
      canvasListResources(request.ProjectID),
      reviewsByAsset(request.ProjectID),
    ]);
    const items = await Promise.all(response.items.map((item) => toResource(item, reviewMap)));
    const keyword = request.Keyword?.trim().toLocaleLowerCase();
    const filtered = items.filter(
      (item) =>
        (!request.Type || item.Type === request.Type) && (!keyword || item.Name.toLocaleLowerCase().includes(keyword)),
    );
    if (request.Sort?.Direction === 1) filtered.sort((a, b) => a.Name.localeCompare(b.Name));
    const start = (request.Page.PageNum - 1) * request.Page.PageSize;
    return {
      Items: filtered.slice(start, start + request.Page.PageSize),
      Page: page(filtered.length, request.Page.PageNum, request.Page.PageSize),
    };
  },
  async GetResource(request: resource.GetResourceRequest): Promise<resource.GetResourceResponse> {
    const value = (await canvasListResources(request.ProjectID)).items.find((item) => item.id === request.ResourceID);
    if (!value) throw new Error("资源不存在");
    return { Resource: await toResource(value) };
  },
  async GetProjectResourceStats(
    request: resource.GetProjectResourceStatsRequest,
  ): Promise<resource.GetProjectResourceStatsResponse> {
    const items = (await canvasListResources(request.ProjectID)).items;
    return {
      Stats: {
        CharacterCount: items.filter((item) => item.type === resource.ResourceType.CHARACTER).length,
        SceneCount: items.filter((item) => item.type === resource.ResourceType.SCENE).length,
        PropCount: items.filter((item) => item.type === resource.ResourceType.PROP).length,
        AudioCount: items.filter((item) => item.type === resource.ResourceType.AUDIO).length,
      },
    };
  },
  async CreateResource(request: resource.CreateResourceRequest): Promise<resource.CreateResourceResponse> {
    const created = await canvasCreateResource(request.ProjectID, {
      name: request.Name,
      description: request.Description ?? "",
      type: request.Type,
      expected_revision: 0,
    });
    const files: resource.ResourceAsset[] = [];
    for (const file of request.InitialAssets ?? []) {
      const current = (await canvasListResources(request.ProjectID)).items.find((item) => item.id === created.id);
      if (!current) throw new Error("资源不存在");
      const slot = await canvasCreateGeneratedResourceAsset(request.ProjectID, created.id, {
        expected_revision: current.revision,
      });
      const uploaded = await uploadSelection(
        request.ProjectID,
        created.id,
        slot.id,
        file.BlobID,
        file.Name ?? file.FileName,
      );
      files.push(await toResourceAsset(request.ProjectID, created.id, uploaded, undefined, new Map()));
    }
    const current =
      (await canvasListResources(request.ProjectID)).items.find((item) => item.id === created.id) ?? created;
    return { Resource: await toResource(current), ResourceAssets: files };
  },
  async UpdateResource(request: resource.UpdateResourceRequest): Promise<resource.UpdateResourceResponse> {
    const current = (await canvasListResources(request.ProjectID)).items.find((item) => item.id === request.ResourceID);
    if (!current) throw new Error("资源不存在");
    const updated = await canvasUpdateResource(request.ProjectID, request.ResourceID, {
      name: request.Name ?? current.name,
      description: request.Description ?? current.description,
      type: current.type,
      expected_revision: request.ExpectedRevision,
    });
    return { Resource: await toResource(updated) };
  },
  async DeleteResource(request: resource.DeleteResourceRequest) {
    return canvasDeleteResource(request.ProjectID, request.ResourceID, { expected_revision: request.ExpectedRevision });
  },
  async BatchDeleteResources(request: resource.BatchDeleteResourcesRequest) {
    await Promise.all(
      request.Targets.map((target) =>
        canvasDeleteResource(request.ProjectID, target.ResourceID, { expected_revision: target.ExpectedRevision }),
      ),
    );
    return { DeletedCount: request.Targets.length };
  },
  async ListResourceAssets(request: resource.ListResourceAssetsRequest): Promise<resource.ListResourceAssetsResponse> {
    const [response, resources, reviewMap] = await Promise.all([
      canvasListResourceAssets(request.ProjectID, request.ResourceID),
      canvasListResources(request.ProjectID),
      reviewsByAsset(request.ProjectID),
    ]);
    const primaryId = resources.items.find((item) => item.id === request.ResourceID)?.primary_resource_asset_id;
    const items = await Promise.all(
      response.items.map((item) => toResourceAsset(request.ProjectID, request.ResourceID, item, primaryId, reviewMap)),
    );
    const start = (request.Page.PageNum - 1) * request.Page.PageSize;
    return {
      Items: items.slice(start, start + request.Page.PageSize),
      Page: page(items.length, request.Page.PageNum, request.Page.PageSize),
    };
  },
  async BatchListResourceAssets(
    request: resource.BatchListResourceAssetsRequest,
    _options?: ApiRequestConfig,
  ): Promise<resource.BatchListResourceAssetsResponse> {
    const [resources, reviewMap] = await Promise.all([
      canvasListResources(request.ProjectID),
      reviewsByAsset(request.ProjectID),
    ]);
    const primaryByResource = new Map(resources.items.map((item) => [item.id, item.primary_resource_asset_id]));
    return {
      Groups: await Promise.all(
        request.ResourceIDs.map(async (resourceId) => ({
          ResourceID: resourceId,
          Items: await Promise.all(
            (await canvasListResourceAssets(request.ProjectID, resourceId)).items.map((item) =>
              toResourceAsset(request.ProjectID, resourceId, item, primaryByResource.get(resourceId), reviewMap),
            ),
          ),
        })),
      ),
    };
  },
  async CreateGeneratedResourceAsset(
    request: resource.CreateGeneratedResourceAssetRequest,
  ): Promise<resource.CreateGeneratedResourceAssetResponse> {
    const value = await canvasCreateGeneratedResourceAsset(request.ProjectID, request.ResourceID, {
      expected_revision: request.ExpectedResourceRevision,
    });
    return { ResourceAsset: await toResourceAsset(request.ProjectID, request.ResourceID, value, undefined, new Map()) };
  },
  async CreateResourceAsset(
    request: resource.CreateResourceAssetRequest,
  ): Promise<resource.CreateResourceAssetResponse> {
    const slot = await canvasCreateGeneratedResourceAsset(request.ProjectID, request.ResourceID, {
      expected_revision: request.ExpectedResourceRevision,
    });
    const value = request.BlobID
      ? await uploadSelection(
          request.ProjectID,
          request.ResourceID,
          slot.id,
          request.BlobID,
          request.Name ?? request.FileName ?? slot.name,
        )
      : slot;
    return { ResourceAsset: await toResourceAsset(request.ProjectID, request.ResourceID, value, undefined, new Map()) };
  },
  async UpdateResourceAsset(
    request: resource.UpdateResourceAssetRequest,
  ): Promise<resource.UpdateResourceAssetResponse> {
    const value = await canvasUpdateResourceAsset(request.ProjectID, request.ResourceAssetID, {
      name: request.Name,
      expected_revision: request.ExpectedResourceAssetRevision,
      revision_no: request.ExpectedResourceRevision,
    });
    return { ResourceAsset: await toResourceAsset(request.ProjectID, request.ResourceID, value) };
  },
  async DeleteResourceAsset(request: resource.DeleteResourceAssetRequest) {
    return canvasDeleteResourceAsset(request.ProjectID, request.ResourceAssetID, {
      expected_revision: request.ExpectedResourceAssetRevision,
    });
  },
  async BatchDeleteResourceAssets(request: resource.BatchDeleteResourceAssetsRequest) {
    await Promise.all(
      request.Targets.map((target) =>
        canvasDeleteResourceAsset(request.ProjectID, target.ResourceAssetID, {
          expected_revision: target.ExpectedResourceAssetRevision,
        }),
      ),
    );
    return { DeletedCount: request.Targets.length };
  },
  async SetPrimaryResourceAsset(
    request: resource.SetPrimaryResourceAssetRequest,
  ): Promise<resource.SetPrimaryResourceAssetResponse> {
    const value = await canvasSetPrimaryResourceAsset(request.ProjectID, request.ResourceAssetID, {
      expected_revision: request.ExpectedResourceRevision,
    });
    return { Resource: await toResource(value) };
  },
  async ReplaceUploadedResourceAsset(
    request: resource.ReplaceUploadedResourceAssetRequest,
  ): Promise<resource.ReplaceUploadedResourceAssetResponse> {
    const selection = selectedUpload(request.BlobID);
    const value = await canvasReplaceResourceAsset(
      request.ProjectID,
      request.ResourceAssetID,
      String(request.ExpectedResourceAssetRevision),
      selection.file,
    );
    return { ResourceAsset: await toResourceAsset(request.ProjectID, request.ResourceID, value) };
  },
  async GetResourceAssetGeneration(
    request: resource.GetResourceAssetGenerationRequest,
    _options?: ApiRequestConfig,
  ): Promise<resource.GetResourceAssetGenerationResponse> {
    return {
      Generation: toGeneration(
        request.ProjectID,
        request.ResourceID,
        await canvasGetResourceGeneration(request.ProjectID, request.ResourceAssetID),
      ),
    };
  },
  async UpdateResourceAssetGeneration(
    request: resource.UpdateResourceAssetGenerationRequest,
    _options?: ApiRequestConfig,
  ): Promise<resource.UpdateResourceAssetGenerationResponse> {
    const current = await canvasGetResourceGeneration(request.ProjectID, request.ResourceAssetID);
    const patch = request.Patch;
    const uploadedAssetIDs = patch.UploadedReferences
      ? await Promise.all(
          patch.UploadedReferences.map(async (reference, index) => {
            if (reference.AssetID) return reference.AssetID;
            if (!reference.BlobID) throw new Error("参考图片尚未上传完成");
            const selection = selectedUpload(reference.BlobID);
            const clientID = `${request.ResourceAssetID.slice(0, 16)}-${reference.BlobID.replace(/^selection:/, "").slice(0, 36)}-${index}`;
            const uploaded = await canvasUploadProjectAsset(
              request.ProjectID,
              clientID,
              selection.file,
              { name: reference.FileName ?? selection.file.name },
              { signal: selection.controller.signal },
            );
            completeUpload(reference.BlobID);
            return uploaded.id;
          }),
        )
      : current.config.uploaded_asset_ids;
    const value = await canvasUpdateResourceGeneration(request.ProjectID, request.ResourceAssetID, {
      expected_revision: request.ExpectedRevision,
      config: {
        prompt: patch.Prompt ?? current.config.prompt,
        provider_id: patch.ModelID ?? current.config.provider_id,
        resolution: patch.Resolution == null ? current.config.resolution : String(patch.Resolution),
        aspect_ratio: patch.AspectRatio == null ? current.config.aspect_ratio : String(patch.AspectRatio),
        watermark: patch.Watermark ?? current.config.watermark,
        uploaded_asset_ids: uploadedAssetIDs,
        reference_sequences: (
          patch.ResourceReferences ?? current.config.reference_sequences.map((SequenceNo) => ({ SequenceNo }))
        ).map((item) => item.SequenceNo),
      },
    });
    return { Generation: toGeneration(request.ProjectID, request.ResourceID, value) };
  },
  async StartResourceAssetGeneration(
    request: resource.StartResourceAssetGenerationRequest,
    _options?: ApiRequestConfig,
  ): Promise<resource.StartResourceAssetGenerationResponse> {
    const value = await canvasStartResourceGeneration(request.ProjectID, request.ResourceAssetID, {
      expected_revision: request.ExpectedRevision,
      operation_id: crypto.randomUUID(),
    });
    return { TaskRunID: value.id };
  },
  async CancelResourceAssetGeneration(
    request: resource.CancelResourceAssetGenerationRequest,
    _options?: ApiRequestConfig,
  ) {
    return {
      Run: toGenerationRun(
        await canvasCancelResourceGeneration(request.ProjectID, request.ResourceAssetID, request.TaskRunID),
      ),
    };
  },
  async GetResourceAssetGenerationRun(
    request: resource.GetResourceAssetGenerationRunRequest,
    _options?: ApiRequestConfig,
  ): Promise<resource.GetResourceAssetGenerationRunResponse> {
    const value = (await canvasListResourceGenerationRuns(request.ProjectID, request.ResourceAssetID)).items.find(
      (item) => item.id === request.TaskRunID,
    );
    if (!value) throw new Error("生成记录不存在");
    return { Run: toGenerationRun(value) };
  },
  async BatchGetResourceAssetGenerationStates(
    request: resource.BatchGetResourceAssetGenerationStatesRequest,
    _options?: ApiRequestConfig,
  ): Promise<resource.BatchGetResourceAssetGenerationStatesResponse> {
    const states = await Promise.all(
      request.ResourceAssetIDs.map(async (id) => {
        const runs = await canvasListResourceGenerationRuns(request.ProjectID, id, _options);
        const latest = [...runs.items].sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
        return latest
          ? {
              ResourceAssetID: id,
              TaskRunID: latest.id,
              Status: toGenerationRun(latest).Status,
              ErrorMessage: latest.error || undefined,
            }
          : undefined;
      }),
    );
    return { Items: states.filter((item): item is NonNullable<typeof item> => Boolean(item)) };
  },
  async ListAvailableBenefitPackages(request: { ProjectID: string }) {
    const response = await canvasListAvailableBenefitPackages(request.ProjectID);
    return {
      Items: response.items.map(
        (item): benefit_package.BenefitPackage => ({
          PackageID: item.id,
          IsPreset: item.is_preset,
          Name: item.name,
          ProjectName: "",
          HasAccessKeyID: true,
          HasSecretAccessKey: true,
          Enabled: true,
          ModelIDs: item.model_ids,
          MaterialUsed: item.material_used,
          Revision: 0,
          CreatedBy: "",
          UpdatedBy: "",
          CreatedAt: "",
          UpdatedAt: "",
          ScopeType: item.is_preset
            ? benefit_package.BenefitPackageScopeType.SYSTEM_PRESET_MODELS
            : benefit_package.BenefitPackageScopeType.CUSTOM_MODELS,
        }),
      ),
    };
  },
  async BatchGetAssetReviews(
    request: asset.BatchGetAssetReviewsRequest,
    _options?: ApiRequestConfig,
  ): Promise<asset.BatchGetAssetReviewsResponse> {
    const grouped = await reviewsByAsset(request.ProjectID);
    return { Items: request.AssetIDs.map((id) => ({ AssetID: id, Reviews: grouped.get(id) ?? [] })) };
  },
  async BatchSubmitAssetReviews(
    request: asset.BatchSubmitAssetReviewsRequest,
  ): Promise<asset.BatchSubmitAssetReviewsResponse> {
    const uploadedAssets = new Map<string, Promise<string>>();
    const materializeUpload = (upload: asset.AssetReviewUpload) => {
      let task = uploadedAssets.get(upload.BlobID);
      if (!task) {
        task = (async () => {
          const selection = selectedUpload(upload.BlobID);
          const value = await canvasUploadProjectAsset(
            request.ProjectID,
            upload.ClientID,
            selection.file,
            { name: upload.FileName },
            { signal: selection.controller.signal },
          );
          completeUpload(upload.BlobID);
          return value.id;
        })();
        uploadedAssets.set(upload.BlobID, task);
      }
      return task;
    };
    const items = await Promise.all(
      request.Items.map(async (item) => {
        const assetId = item.AssetID ?? (item.Upload ? await materializeUpload(item.Upload) : undefined);
        if (!assetId) throw new Error("请选择需要送审的素材");
        const review = item.Upload
          ? await canvasSubmitProjectAssetReview(request.ProjectID, assetId, {
              package_id: item.PackageID,
              operation_id: crypto.randomUUID(),
            })
          : await canvasSubmitAssetReview(request.ProjectID, assetId, {
              package_id: item.PackageID,
              operation_id: crypto.randomUUID(),
            });
        return { AssetID: assetId, PackageID: item.PackageID, Review: toReview(review) };
      }),
    );
    return { Items: items };
  },
  async ListProjectModels(request: project.ListProjectModelsRequest): Promise<project.ListProjectModelsResponse> {
    const response = await fetchModelProviders();
    const items: project.ProjectModelInfo[] = response
      .map((item) => ({
        ID: item.id,
        Name: item.name,
        Type: providerModelType(item.provider_kind),
        FeaturesConfig: providerModelFeatures(item),
        Property: providerModelProperty(item),
        IsPublic: true,
        IsDefault: item.is_default,
        ModelName: item.model,
        Provider: item.provider_kind,
        Status: item.is_enabled ? "Running" : "Disabled",
        Granted: item.is_enabled,
      }))
      .filter(
        (item) =>
          (!request.Filter?.IsGranted || item.Granted) &&
          (!request.Filter?.Types?.length || request.Filter.Types.includes(item.Type)) &&
          (!request.Filter?.Statuses?.length || request.Filter.Statuses.includes(item.Status ?? "")) &&
          (!request.Filter?.Features?.length ||
            request.Filter.Features.some((feature) => item.FeaturesConfig?.includes(feature))),
      );
    return { Items: items, Total: items.length };
  },
  async CreateResourceFromAsset(
    request: resource.CreateResourceFromAssetRequest,
  ): Promise<resource.CreateResourceFromAssetResponse> {
    if (!request.CanvasID || !request.CanvasNodeID) throw new Error("需要从画布节点保存到资产库");
    const value = await canvasResourceFromNode(request.CanvasID, request.CanvasNodeID, {
      resource_id: crypto.randomUUID(),
      name: request.Name,
      description: request.Description ?? "",
      type: request.Type,
    });
    const mapped = await toResource(value);
    const primary = (await canvasListResourceAssets(request.ProjectID, value.id)).items[0];
    if (!primary) throw new Error("资产已创建，但没有可用素材");
    return {
      Resource: mapped,
      ResourceAsset: await toResourceAsset(request.ProjectID, value.id, primary),
    };
  },
  async SearchCanvasNodeAssets(
    request: canvasnode.SearchCanvasNodeAssetsRequest,
    _options?: ApiRequestConfig,
  ): Promise<canvasnode.SearchCanvasNodeAssetsResponse> {
    const response = await canvasSearchCreativeAssets(request.ProjectID, {
      params: { query: request.Keyword, limit: request.Limit },
      skipErrorNotify: true,
    });
    return {
      Items: response.items.map((item) => ({
        ID: item.resource_asset_id ? `resource:${item.resource_asset_id}` : `node:${item.node_id}`,
        Label: item.name,
        Children: [],
        MediaType: item.media_type,
        CanvasNodeID: item.canvas_id === request.CanvasID ? item.node_id : undefined,
        AssetID: item.current_asset_id,
        ResourceID: item.resource_id || undefined,
        ResourceAssetID: item.resource_asset_id || undefined,
        ResourceType: item.resource_type,
        ReferenceType: item.resource_asset_id
          ? canvasnode.CanvasNodeMentionReferenceType.RESOURCE_ASSET
          : canvasnode.CanvasNodeMentionReferenceType.ASSET,
        Available: true,
      })),
    };
  },
  async MaterializeCanvasResourceAssetReference(
    request: canvasnode.MaterializeCanvasResourceAssetReferenceRequest,
    options?: ApiRequestConfig,
  ): Promise<canvasnode.MaterializeCanvasResourceAssetReferenceResponse> {
    const created = await CreateCanvasNode(
      {
        ProjectID: request.ProjectID,
        CanvasID: request.CanvasID,
        Type: canvasnode.CanvasNodeType.IMAGE_ASSET,
        Position: request.ResourceAssetNodePosition,
        ResourceID: request.ResourceID,
        ResourceAssetID: request.ResourceAssetID,
      },
      options,
    );
    const connected = await ConnectCanvasNodes(
      {
        ProjectID: request.ProjectID,
        CanvasID: request.CanvasID,
        SourceNodeID: created.CanvasNode.NodeID,
        TargetNodeID: request.TargetNodeID,
        TargetPort: request.TargetPort,
      },
      options,
    );
    return {
      ResourceAssetNode: created.CanvasNode,
      TargetNode: connected.TargetNode,
      CanvasRevision: connected.CanvasRevision,
      CreatedResourceAssetNode: true,
    };
  },
  async MaterializeCanvasStandaloneAssetReference(
    request: canvasnode.MaterializeCanvasStandaloneAssetReferenceRequest,
    options?: ApiRequestConfig,
  ): Promise<canvasnode.MaterializeCanvasStandaloneAssetReferenceResponse> {
    const created = await CreateCanvasNode(
      {
        ProjectID: request.ProjectID,
        CanvasID: request.CanvasID,
        Type: canvasnode.CanvasNodeType.IMAGE_ASSET,
        Position: request.AssetNodePosition,
        AssetID: request.AssetID,
        UploadedAsset: request.UploadedAsset,
      },
      options,
    );
    const connected = await ConnectCanvasNodes(
      {
        ProjectID: request.ProjectID,
        CanvasID: request.CanvasID,
        SourceNodeID: created.CanvasNode.NodeID,
        TargetNodeID: request.TargetNodeID,
        TargetPort: request.TargetPort,
      },
      options,
    );
    return {
      AssetNode: created.CanvasNode,
      TargetNode: connected.TargetNode,
      CanvasRevision: connected.CanvasRevision,
      CreatedAssetNode: true,
    };
  },
  async UpdateCanvasView(request: canvas.UpdateCanvasViewRequest, options?: ApiRequestConfig) {
    const board = (await canvasListBoards(request.ProjectID, undefined, options)).items.find(
      (item) => item.id === request.CanvasID,
    );
    if (!board) throw new Error("剧集不存在");
    await canvasUpdateCanvasView(
      request.CanvasID,
      { default_view: request.DefaultView ?? board.default_view, expected_revision: board.revision },
      options,
    );
  },
  CreateCanvasNode,
  UpdateCanvasNode,
  DeleteCanvasNode,
  BatchGetCanvasNodeStates,
  StartCanvasNodeGeneration,
  StartCanvasGeneration,
  CancelCanvasNodeGeneration,
  ListCanvasNodeHistories,
  SelectCanvasNodeHistory,
};

export type AgentFrameService = typeof agentframeService;

export const silentRequestConfig = { skipErrorNotify: true } satisfies ApiRequestConfig;

export const SortDirection = { Asc: 1, Desc: 2 } as const;
