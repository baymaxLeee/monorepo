import {
  canvasCancelResourceGeneration,
  canvasBatchDeleteResourceAssets,
  canvasBatchDeleteResources,
  canvasBatchGetResourceGenerationStates,
  canvasBatchListResourceAssets,
  canvasCreateGeneratedResourceAsset,
  canvasCreateResource,
  canvasCreateResourceAsset,
  canvasCreateResourceFromAsset,
  canvasDeleteResource,
  canvasDeleteResourceAsset,
  canvasGetResource,
  canvasGetResourceGeneration,
  canvasGetResourceGenerationRun,
  canvasGetProjectResourceStats,
  canvasListResourceAssets,
  canvasListResources,
  canvasReplaceResourceAsset,
  canvasSetPrimaryResourceAsset,
  canvasStartResourceGeneration,
  canvasUpdateResource,
  canvasUpdateResourceAsset,
  canvasUpdateResourceGeneration,
  type ApiRequestConfig,
  type CanvasAssetReview,
  type CanvasResource,
  type CanvasResourceAsset,
  type CanvasResourceAssetGeneration,
  type CanvasResourceAssetGenerationRun,
  type CanvasResourceAssetGenerationState,
} from "@repo/api";

import { resource } from "@/domain";
import type { asset } from "@/domain";

const SILENT_REQUEST: ApiRequestConfig = { skipErrorNotify: true };

export const ASPECT_RATIO_TO_API: Record<string, resource.ResourceAssetGenerationAspectRatio> = {
  "1:1": resource.ResourceAssetGenerationAspectRatio.RATIO_1_1,
  "3:4": resource.ResourceAssetGenerationAspectRatio.RATIO_3_4,
  "4:3": resource.ResourceAssetGenerationAspectRatio.RATIO_4_3,
  "9:16": resource.ResourceAssetGenerationAspectRatio.RATIO_9_16,
  "16:9": resource.ResourceAssetGenerationAspectRatio.RATIO_16_9,
  "3:2": resource.ResourceAssetGenerationAspectRatio.RATIO_3_2,
  "2:3": resource.ResourceAssetGenerationAspectRatio.RATIO_2_3,
  "21:9": resource.ResourceAssetGenerationAspectRatio.RATIO_21_9,
};

export const ASPECT_RATIO_FROM_API: Record<number, string> = Object.fromEntries(
  Object.entries(ASPECT_RATIO_TO_API).map(([label, value]) => [value, label]),
);

export const RESOLUTION_TO_API: Record<string, resource.ResourceAssetGenerationResolution> = {
  "480P": resource.ResourceAssetGenerationResolution.RESOLUTION_480P,
  "720P": resource.ResourceAssetGenerationResolution.RESOLUTION_720P,
  "1080P": resource.ResourceAssetGenerationResolution.RESOLUTION_1080P,
  "2K": resource.ResourceAssetGenerationResolution.RESOLUTION_2K,
  "4K": resource.ResourceAssetGenerationResolution.RESOLUTION_4K,
};

export const RESOLUTION_FROM_API: Record<number, string> = Object.fromEntries(
  Object.entries(RESOLUTION_TO_API).map(([label, value]) => [value, label]),
);

function reviewFromDTO(value: CanvasAssetReview): asset.AssetReview {
  return {
    PackageID: value.package_id,
    PackageName: value.package_name,
    Status: value.status,
    FailureReason: value.failure_reason,
    SubmittedAt: value.submitted_at,
    UpdatedAt: value.updated_at,
  };
}

function stateFromDTO(value: CanvasResourceAssetGenerationState): resource.ResourceAssetGenerationState {
  return {
    ResourceAssetID: value.resource_asset_id,
    TaskRunID: value.task_run_id,
    Status: value.status,
    ErrorCode: value.error_code,
    ErrorMessage: value.error_message,
  };
}

function resourceAssetFromDTO(value: CanvasResourceAsset): resource.ResourceAsset {
  return {
    ResourceAssetID: value.resource_asset_id,
    ResourceID: value.resource_id,
    Name: value.name,
    SequenceNo: value.sequence_no,
    CurrentAssetID: value.current_asset_id,
    IsPrimary: value.is_primary,
    Revision: value.revision,
    CreatedAt: value.created_at,
    UpdatedAt: value.updated_at,
    PreviewURL: value.preview_url,
    ExpiresAt: value.expires_at,
    MediaType: value.media_type,
    SourceType: value.source_type,
    Reviews: value.reviews?.map(reviewFromDTO),
    GenerationState: value.generation_state ? stateFromDTO(value.generation_state) : undefined,
  };
}

function resourceFromDTO(value: CanvasResource): resource.Resource {
  return {
    ResourceID: value.resource_id,
    ProjectID: value.project_id,
    Type: value.type,
    Name: value.name,
    Description: value.description,
    PrimaryResourceAsset: value.primary_resource_asset
      ? {
          ResourceAssetID: value.primary_resource_asset.resource_asset_id,
          Name: value.primary_resource_asset.name,
          CurrentAssetID: value.primary_resource_asset.current_asset_id,
          PreviewURL: value.primary_resource_asset.preview_url,
          ExpiresAt: value.primary_resource_asset.expires_at,
          MediaType: value.primary_resource_asset.media_type,
          SourceType: value.primary_resource_asset.source_type,
          Reviews: value.primary_resource_asset.reviews?.map(reviewFromDTO),
        }
      : undefined,
    ResourceAssetCount: value.resource_asset_count,
    Revision: value.revision,
    CreatedBy: value.created_by,
    CreatedAt: value.created_at,
    UpdatedAt: value.updated_at,
    OwnerType: value.owner_type,
    ApprovedResourceAssetCount: value.approved_resource_asset_count,
  };
}

function runFromDTO(value: CanvasResourceAssetGenerationRun): resource.ResourceAssetGenerationRun {
  return {
    TaskRunID: value.task_run_id,
    Status: value.status,
    Prompt: value.prompt,
    ModelID: value.model_id,
    Resolution: value.resolution,
    AspectRatio: value.aspect_ratio,
    Watermark: value.watermark,
    Inputs: value.inputs.map((input) => ({
      Position: input.position,
      SourceType: input.source_type,
      AssetID: input.asset_id,
    })),
    OutputAssetID: value.output_asset_id,
    ErrorCode: value.error_code,
    ErrorMessage: value.error_message,
    StartedAt: value.started_at,
    FinishedAt: value.finished_at,
    CreatedAt: value.created_at,
    UpdatedAt: value.updated_at,
  };
}

function generationFromDTO(value: CanvasResourceAssetGeneration): resource.ResourceAssetGeneration {
  return {
    Prompt: value.prompt,
    ModelID: value.model_id,
    Resolution: value.resolution,
    AspectRatio: value.aspect_ratio,
    Watermark: value.watermark,
    UploadedReferences: value.uploaded_references.map((reference) => ({
      AssetID: reference.asset_id,
      FileName: reference.file_name,
      PreviewURL: reference.preview_url,
    })),
    ResourceReferences: value.resource_references.map((reference) => ({
      ResourceID: reference.resource_id,
      SequenceNo: reference.sequence_no,
    })),
    Revision: value.revision,
    ActiveTaskRunID: value.active_task_run_id,
    LatestRun: value.latest_run ? runFromDTO(value.latest_run) : undefined,
  };
}

export async function getResource(projectId: string, resourceId: string) {
  return resourceFromDTO((await canvasGetResource(projectId, resourceId)).resource);
}

export async function getProjectResourceStats(projectId: string): Promise<resource.ProjectResourceStats> {
  const stats = (await canvasGetProjectResourceStats(projectId)).stats;
  return {
    CharacterCount: stats.character_count,
    SceneCount: stats.scene_count,
    PropCount: stats.prop_count,
    AudioCount: stats.audio_count,
  };
}

export async function listResources(
  projectId: string,
  options: { keyword: string; ascending: boolean; pageNum: number; pageSize: number; type?: resource.ResourceType },
) {
  const response = await canvasListResources(projectId, {
    keyword: options.keyword.trim() || undefined,
    type: options.type,
    sort_direction: options.ascending ? "ASC" : "DESC",
    page_num: options.pageNum,
    page_size: options.pageSize,
  });
  return { items: response.items.map(resourceFromDTO), total: response.page.total };
}

export async function createResource(
  projectId: string,
  input: {
    name: string;
    description?: string;
    type: resource.ResourceType;
    files?: Array<{ blobId: string; fileName: string; name?: string }>;
  },
) {
  const response = await canvasCreateResource(projectId, {
    type: input.type,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    initial_assets: input.files?.map((file) => ({
      blob_id: file.blobId,
      file_name: file.fileName,
      name: file.name?.trim() || undefined,
    })),
  });
  return resourceFromDTO(response.resource);
}

export async function createResourceFromExistingAsset(
  projectId: string,
  assetId: string,
  input: { name: string; description?: string; type: resource.ResourceType; canvasId?: string; canvasNodeId?: string },
) {
  const response = await canvasCreateResourceFromAsset(projectId, {
    asset_id: assetId,
    type: input.type,
    name: input.name.trim(),
    description: input.description?.trim() || undefined,
    canvas_id: input.canvasId,
    canvas_node_id: input.canvasNodeId,
  });
  return {
    Resource: resourceFromDTO(response.resource),
    ResourceAsset: resourceAssetFromDTO(response.resource_asset),
    CanvasNodeBinding: response.canvas_node_binding
      ? {
          CanvasID: response.canvas_node_binding.canvas_id,
          CanvasNodeID: response.canvas_node_binding.canvas_node_id,
          ResourceAssetID: response.canvas_node_binding.resource_asset_id,
          CurrentAssetID: response.canvas_node_binding.current_asset_id,
          CanvasNodeRevision: response.canvas_node_binding.canvas_node_revision,
        }
      : undefined,
  };
}

export async function addResourceFile(
  projectId: string,
  resourceId: string,
  resourceRevision: number,
  input: { blobId: string; fileName: string; name?: string },
) {
  const response = await canvasCreateResourceAsset(projectId, resourceId, {
    blob_id: input.blobId,
    file_name: input.fileName,
    name: input.name?.trim() || undefined,
    expected_resource_revision: resourceRevision,
  });
  return resourceAssetFromDTO(response.resource_asset);
}

export async function updateResource(
  projectId: string,
  current: resource.Resource,
  input: { name: string; description?: string },
) {
  const response = await canvasUpdateResource(projectId, current.ResourceID, {
    name: input.name.trim(),
    description: input.description?.trim() ?? "",
    expected_revision: current.Revision,
  });
  return resourceFromDTO(response.resource);
}

export function deleteResource(projectId: string, resourceId: string, expectedRevision: number) {
  return canvasDeleteResource(projectId, resourceId, { expected_revision: expectedRevision });
}

export async function batchDeleteResources(projectId: string, items: resource.Resource[]) {
  await canvasBatchDeleteResources(projectId, {
    targets: items.map((item) => ({ resource_id: item.ResourceID, expected_revision: item.Revision })),
  });
}

export async function listResourceFilesPage(projectId: string, resourceId: string, pageNum: number, pageSize: number) {
  const response = await canvasListResourceAssets(projectId, resourceId, { page_num: pageNum, page_size: pageSize });
  return { items: response.items.map(resourceAssetFromDTO), total: response.page.total };
}

export async function listResourceFiles(projectId: string, resourceId: string) {
  const pageSize = 100;
  const items: resource.ResourceAsset[] = [];
  for (let pageNum = 1; ; pageNum += 1) {
    const response = await canvasListResourceAssets(projectId, resourceId, { page_num: pageNum, page_size: pageSize });
    items.push(...response.items.map(resourceAssetFromDTO));
    if (response.items.length === 0 || items.length >= response.page.total) return items;
  }
}

export async function batchListResourceFiles(projectId: string, resourceIds: string[]) {
  const response = await canvasBatchListResourceAssets(projectId, { resource_ids: resourceIds });
  return response.groups.map((group) => ({
    ResourceID: group.resource_id,
    Items: group.items.map(resourceAssetFromDTO),
  }));
}

export async function setPrimaryResourceFile(
  projectId: string,
  resourceId: string,
  resourceAssetId: string,
  expectedResourceRevision: number,
) {
  const response = await canvasSetPrimaryResourceAsset(projectId, resourceId, resourceAssetId, {
    resource_asset_id: resourceAssetId,
    expected_resource_revision: expectedResourceRevision,
  });
  return resourceFromDTO(response.resource);
}

export async function renameResourceFile(
  projectId: string,
  resourceId: string,
  current: resource.ResourceAsset,
  expectedResourceRevision: number,
  name: string,
) {
  const response = await canvasUpdateResourceAsset(projectId, resourceId, current.ResourceAssetID, {
    resource_asset_id: current.ResourceAssetID,
    name: name.trim(),
    expected_resource_revision: expectedResourceRevision,
    expected_resource_asset_revision: current.Revision,
  });
  return resourceAssetFromDTO(response.resource_asset);
}

export function deleteResourceFile(
  projectId: string,
  resourceId: string,
  current: resource.ResourceAsset,
  expectedResourceRevision: number,
) {
  return canvasDeleteResourceAsset(projectId, resourceId, current.ResourceAssetID, {
    resource_asset_id: current.ResourceAssetID,
    expected_resource_revision: expectedResourceRevision,
    expected_resource_asset_revision: current.Revision,
  });
}

export async function batchDeleteResourceFiles(
  projectId: string,
  resourceId: string,
  files: resource.ResourceAsset[],
  expectedResourceRevision: number,
) {
  await canvasBatchDeleteResourceAssets(projectId, resourceId, {
    targets: files.map((file, index) => ({
      resource_asset_id: file.ResourceAssetID,
      expected_resource_revision: expectedResourceRevision + index,
      expected_resource_asset_revision: file.Revision,
    })),
  });
}

export async function createGeneratedResourceAsset(
  projectId: string,
  resourceId: string,
  expectedResourceRevision: number,
) {
  const response = await canvasCreateGeneratedResourceAsset(projectId, resourceId, {
    expected_resource_revision: expectedResourceRevision,
  });
  return resourceAssetFromDTO(response.resource_asset);
}

export async function getResourceAssetGeneration(projectId: string, resourceId: string, resourceAssetId: string) {
  return generationFromDTO((await canvasGetResourceGeneration(projectId, resourceId, resourceAssetId)).generation);
}

export async function batchGetResourceAssetGenerationStates(
  projectId: string,
  resourceId: string,
  resourceAssetIds: string[],
) {
  const response = await canvasBatchGetResourceGenerationStates(
    projectId,
    resourceId,
    { resource_asset_ids: resourceAssetIds },
    SILENT_REQUEST,
  );
  return response.items.map(stateFromDTO);
}

export async function updateResourceAssetGeneration(
  projectId: string,
  resourceId: string,
  resourceAssetId: string,
  patch: resource.ResourceAssetGenerationPatch,
  expectedRevision: number,
) {
  const response = await canvasUpdateResourceGeneration(
    projectId,
    resourceId,
    resourceAssetId,
    {
      resource_asset_id: resourceAssetId,
      expected_revision: expectedRevision,
      patch: {
        prompt: patch.Prompt,
        model_id: patch.ModelID,
        resolution: patch.Resolution,
        aspect_ratio: patch.AspectRatio,
        watermark: patch.Watermark,
        uploaded_references: patch.UploadedReferences?.map((reference) => ({
          asset_id: reference.AssetID,
          blob_id: reference.BlobID,
          file_name: reference.FileName,
        })),
        resource_references: patch.ResourceReferences?.map((reference) => ({
          resource_id: reference.ResourceID,
          sequence_no: reference.SequenceNo,
        })),
      },
    },
    SILENT_REQUEST,
  );
  return generationFromDTO(response.generation);
}

export async function startResourceAssetGeneration(
  projectId: string,
  resourceId: string,
  resourceAssetId: string,
  expectedRevision: number,
) {
  const response = await canvasStartResourceGeneration(
    projectId,
    resourceId,
    resourceAssetId,
    { resource_asset_id: resourceAssetId, expected_revision: expectedRevision },
    SILENT_REQUEST,
  );
  return response.task_run_id;
}

export async function getResourceAssetGenerationRun(
  projectId: string,
  resourceId: string,
  resourceAssetId: string,
  taskRunId: string,
) {
  const response = await canvasGetResourceGenerationRun(
    projectId,
    resourceId,
    resourceAssetId,
    taskRunId,
    SILENT_REQUEST,
  );
  return runFromDTO(response.run);
}

export function cancelResourceAssetGeneration(
  projectId: string,
  resourceId: string,
  resourceAssetId: string,
  taskRunId: string,
) {
  return canvasCancelResourceGeneration(projectId, resourceId, resourceAssetId, taskRunId, SILENT_REQUEST);
}

export async function replaceUploadedResourceAsset(
  projectId: string,
  resourceId: string,
  current: resource.ResourceAsset,
  expectedResourceRevision: number,
  input: { blobId: string; fileName: string },
) {
  const response = await canvasReplaceResourceAsset(projectId, resourceId, current.ResourceAssetID, {
    resource_asset_id: current.ResourceAssetID,
    blob_id: input.blobId,
    file_name: input.fileName,
    expected_resource_revision: expectedResourceRevision,
    expected_resource_asset_revision: current.Revision,
  });
  return resourceAssetFromDTO(response.resource_asset);
}
