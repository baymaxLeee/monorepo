import { type AgentFrameService, type TApiRequestConfig } from "@/api/agentframe";
import { resource } from "@/domain";

/** 轮询/静默请求配置，避免生图过程中的成功/失败弹层打扰用户。 */
const SILENT_SUCCESS: TApiRequestConfig = {
  skipErrorNotify: true,
};
const SILENT_POLL: TApiRequestConfig = {
  skipErrorNotify: true,
};

/** 前端字符串比例 ↔ 后端枚举映射，口径与 resource.thrift 8 值保持一致。 */
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

type ListService = Pick<AgentFrameService, "ListResources">;
type CreateService = Pick<AgentFrameService, "CreateResource">;
type AddFileService = Pick<AgentFrameService, "CreateResourceAsset">;
type CreateFromExistingAssetService = Pick<AgentFrameService, "CreateResourceFromAsset">;

export async function getResource(
  service: Pick<AgentFrameService, "GetResource">,
  projectId: string,
  resourceId: string,
) {
  const response = await service.GetResource({
    ProjectID: projectId,
    ResourceID: resourceId,
  });
  return response.Resource;
}

export async function getProjectResourceStats(
  service: Pick<AgentFrameService, "GetProjectResourceStats">,
  projectId: string,
) {
  const response = await service.GetProjectResourceStats({
    ProjectID: projectId,
  });
  return response.Stats;
}

export async function listResources(
  service: ListService,
  projectId: string,
  options: {
    keyword: string;
    ascending: boolean;
    pageNum: number;
    pageSize: number;
    type?: resource.ResourceType;
  },
) {
  const response = await service.ListResources({
    ProjectID: projectId,
    Type: options.type,
    Keyword: options.keyword.trim() || undefined,
    Sort: {
      Field: resource.ResourceSortField.UPDATED_AT,
      Direction: options.ascending ? 1 : 2,
    },
    Page: { PageNum: options.pageNum, PageSize: options.pageSize },
  });
  return { items: response.Items, total: response.Page.Total };
}

export async function createResource(
  service: CreateService,
  projectId: string,
  input: {
    name: string;
    description?: string;
    type: resource.ResourceType;
    files?: Array<{ blobId: string; fileName: string; name?: string }>;
  },
) {
  const files = input.files ?? [];
  const response = await service.CreateResource({
    ProjectID: projectId,
    Type: input.type,
    Name: input.name.trim(),
    Description: input.description?.trim() || undefined,
    ...(files.length > 0 && {
      InitialAssets: files.map((file) => ({
        BlobID: file.blobId,
        FileName: file.fileName,
        Name: file.name?.trim() || undefined,
      })),
    }),
  });
  return response.Resource;
}

export async function createResourceFromExistingAsset(
  service: CreateFromExistingAssetService,
  projectId: string,
  assetId: string,
  input: {
    name: string;
    description?: string;
    type: resource.ResourceType;
    canvasId?: string;
    canvasNodeId?: string;
  },
) {
  const response = await service.CreateResourceFromAsset({
    ProjectID: projectId,
    AssetID: assetId,
    Type: input.type,
    Name: input.name.trim(),
    Description: input.description?.trim() || undefined,
    CanvasID: input.canvasId,
    CanvasNodeID: input.canvasNodeId,
  });
  return response;
}

export async function addResourceFile(
  service: AddFileService,
  projectId: string,
  resourceId: string,
  resourceRevision: number,
  input: { blobId: string; fileName: string; name?: string },
) {
  const response = await service.CreateResourceAsset({
    ProjectID: projectId,
    ResourceID: resourceId,
    BlobID: input.blobId,
    FileName: input.fileName,
    Name: input.name?.trim() || undefined,
    ExpectedResourceRevision: resourceRevision,
  });
  return response.ResourceAsset;
}

export async function updateResource(
  service: Pick<AgentFrameService, "UpdateResource">,
  projectId: string,
  current: resource.Resource,
  input: { name: string; description?: string },
) {
  const response = await service.UpdateResource({
    ProjectID: projectId,
    ResourceID: current.ResourceID,
    Name: input.name.trim(),
    Description: input.description?.trim() ?? "",
    ExpectedRevision: current.Revision,
  });
  return response.Resource;
}

export async function deleteResource(
  service: Pick<AgentFrameService, "DeleteResource">,
  projectId: string,
  resourceId: string,
  expectedRevision: number,
) {
  return service.DeleteResource({
    ProjectID: projectId,
    ResourceID: resourceId,
    ExpectedRevision: expectedRevision,
  });
}

export function batchDeleteResources(
  service: Pick<AgentFrameService, "BatchDeleteResources">,
  projectId: string,
  items: resource.Resource[],
) {
  return service.BatchDeleteResources({
    ProjectID: projectId,
    Targets: items.map((item) => ({
      ResourceID: item.ResourceID,
      ExpectedRevision: item.Revision,
    })),
  });
}

export async function listResourceFilesPage(
  service: Pick<AgentFrameService, "ListResourceAssets">,
  projectId: string,
  resourceId: string,
  pageNum: number,
  pageSize: number,
) {
  const response = await service.ListResourceAssets({
    ProjectID: projectId,
    ResourceID: resourceId,
    Page: { PageNum: pageNum, PageSize: pageSize },
  });
  return { items: response.Items, total: response.Page.Total };
}

export async function listResourceFiles(
  service: Pick<AgentFrameService, "ListResourceAssets">,
  projectId: string,
  resourceId: string,
) {
  const pageSize = 100;
  const items: resource.ResourceAsset[] = [];
  for (let pageNum = 1; ; pageNum += 1) {
    const response = await listResourceFilesPage(service, projectId, resourceId, pageNum, pageSize);
    items.push(...response.items);
    if (response.items.length === 0 || items.length >= response.total) {
      return items;
    }
  }
}

export async function batchListResourceFiles(
  service: Pick<AgentFrameService, "BatchListResourceAssets">,
  projectId: string,
  resourceIds: string[],
) {
  const response = await service.BatchListResourceAssets({
    ProjectID: projectId,
    ResourceIDs: resourceIds,
  });
  return response.Groups;
}

export async function setPrimaryResourceFile(
  service: Pick<AgentFrameService, "SetPrimaryResourceAsset">,
  projectId: string,
  resourceId: string,
  resourceAssetId: string,
  expectedResourceRevision: number,
) {
  const response = await service.SetPrimaryResourceAsset({
    ProjectID: projectId,
    ResourceID: resourceId,
    ResourceAssetID: resourceAssetId,
    ExpectedResourceRevision: expectedResourceRevision,
  });
  return response.Resource;
}

export async function renameResourceFile(
  service: Pick<AgentFrameService, "UpdateResourceAsset">,
  projectId: string,
  resourceId: string,
  current: resource.ResourceAsset,
  expectedResourceRevision: number,
  name: string,
) {
  const response = await service.UpdateResourceAsset({
    ProjectID: projectId,
    ResourceID: resourceId,
    ResourceAssetID: current.ResourceAssetID,
    Name: name.trim(),
    ExpectedResourceRevision: expectedResourceRevision,
    ExpectedResourceAssetRevision: current.Revision,
  });
  return response.ResourceAsset;
}

export function deleteResourceFile(
  service: Pick<AgentFrameService, "DeleteResourceAsset">,
  projectId: string,
  resourceId: string,
  current: resource.ResourceAsset,
  expectedResourceRevision: number,
) {
  return service.DeleteResourceAsset({
    ProjectID: projectId,
    ResourceID: resourceId,
    ResourceAssetID: current.ResourceAssetID,
    ExpectedResourceRevision: expectedResourceRevision,
    ExpectedResourceAssetRevision: current.Revision,
  });
}

export function batchDeleteResourceFiles(
  service: Pick<AgentFrameService, "BatchDeleteResourceAssets">,
  projectId: string,
  resourceId: string,
  files: resource.ResourceAsset[],
  expectedResourceRevision: number,
) {
  return service.BatchDeleteResourceAssets({
    ProjectID: projectId,
    ResourceID: resourceId,
    Targets: files.map((file, index) => ({
      ResourceAssetID: file.ResourceAssetID,
      ExpectedResourceRevision: expectedResourceRevision + index,
      ExpectedResourceAssetRevision: file.Revision,
    })),
  });
}

/**
 * 新建一个生成型子图槽位（含服务端生成草稿）。返回槽位与其初始 Revision，
 * 后续 prompt/参考图/参数经 UpdateResourceAssetGeneration 默认保存到该草稿。
 */
export async function createGeneratedResourceAsset(
  service: Pick<AgentFrameService, "CreateGeneratedResourceAsset">,
  projectId: string,
  resourceId: string,
  expectedResourceRevision: number,
) {
  const response = await service.CreateGeneratedResourceAsset({
    ProjectID: projectId,
    ResourceID: resourceId,
    ExpectedResourceRevision: expectedResourceRevision,
  });
  return response.ResourceAsset;
}

export async function getResourceAssetGeneration(
  service: Pick<AgentFrameService, "GetResourceAssetGeneration">,
  projectId: string,
  resourceId: string,
  resourceAssetId: string,
) {
  const response = await service.GetResourceAssetGeneration({
    ProjectID: projectId,
    ResourceID: resourceId,
    ResourceAssetID: resourceAssetId,
  });
  return response.Generation;
}

export async function batchGetResourceAssetGenerationStates(
  service: Pick<AgentFrameService, "BatchGetResourceAssetGenerationStates">,
  projectId: string,
  resourceId: string,
  resourceAssetIds: string[],
) {
  const response = await service.BatchGetResourceAssetGenerationStates(
    {
      ProjectID: projectId,
      ResourceID: resourceId,
      ResourceAssetIDs: resourceAssetIds,
    },
    SILENT_POLL,
  );
  return response.Items;
}

/**
 * 默认保存：把 prompt / 参考图 / 生成参数落库到子图服务端生成配置。
 * 只传入有变化的字段（Patch 语义），并携带乐观锁 Revision 避免并发覆盖。
 */
export async function updateResourceAssetGeneration(
  service: Pick<AgentFrameService, "UpdateResourceAssetGeneration">,
  projectId: string,
  resourceId: string,
  resourceAssetId: string,
  patch: resource.ResourceAssetGenerationPatch,
  expectedRevision: number,
) {
  const response = await service.UpdateResourceAssetGeneration(
    {
      ProjectID: projectId,
      ResourceID: resourceId,
      ResourceAssetID: resourceAssetId,
      Patch: patch,
      ExpectedRevision: expectedRevision,
    },
    SILENT_SUCCESS,
  );
  return response.Generation;
}

export async function startResourceAssetGeneration(
  service: Pick<AgentFrameService, "StartResourceAssetGeneration">,
  projectId: string,
  resourceId: string,
  resourceAssetId: string,
  expectedRevision: number,
) {
  const response = await service.StartResourceAssetGeneration(
    {
      ProjectID: projectId,
      ResourceID: resourceId,
      ResourceAssetID: resourceAssetId,
      ExpectedRevision: expectedRevision,
    },
    SILENT_SUCCESS,
  );
  return response.TaskRunID;
}

export async function getResourceAssetGenerationRun(
  service: Pick<AgentFrameService, "GetResourceAssetGenerationRun">,
  projectId: string,
  resourceId: string,
  resourceAssetId: string,
  taskRunId: string,
) {
  const response = await service.GetResourceAssetGenerationRun(
    {
      ProjectID: projectId,
      ResourceID: resourceId,
      ResourceAssetID: resourceAssetId,
      TaskRunID: taskRunId,
    },
    SILENT_POLL,
  );
  return response.Run;
}

export function cancelResourceAssetGeneration(
  service: Pick<AgentFrameService, "CancelResourceAssetGeneration">,
  projectId: string,
  resourceId: string,
  resourceAssetId: string,
  taskRunId: string,
) {
  return service.CancelResourceAssetGeneration(
    {
      ProjectID: projectId,
      ResourceID: resourceId,
      ResourceAssetID: resourceAssetId,
      TaskRunID: taskRunId,
    },
    SILENT_SUCCESS,
  );
}

/** 覆盖上传：把已选定的子图替换为新上传的图片文件（仅一张、覆盖语义）。 */
export async function replaceUploadedResourceAsset(
  service: Pick<AgentFrameService, "ReplaceUploadedResourceAsset">,
  projectId: string,
  resourceId: string,
  current: resource.ResourceAsset,
  expectedResourceRevision: number,
  input: { blobId: string; fileName: string },
) {
  const response = await service.ReplaceUploadedResourceAsset({
    ProjectID: projectId,
    ResourceID: resourceId,
    ResourceAssetID: current.ResourceAssetID,
    BlobID: input.blobId,
    FileName: input.fileName,
    ExpectedResourceRevision: expectedResourceRevision,
    ExpectedResourceAssetRevision: current.Revision,
  });
  return response.ResourceAsset;
}
