import { getCanvasService } from "../generated/canvas-server/index";
import { getChatService } from "../generated/chat-server/index";
import type { AssetUploadPlan } from "./asset-server";
import { authFetch } from "./auth-fetch";
import { API_BASE_URL } from "./http";

export * from "../generated/canvas-server/index";

export const {
  canvasListAvailableBenefitPackages,
  canvasAdminGetProject,
  canvasAdminListProjects,
  canvasAdminCreateProject,
  canvasAdminDeleteProject,
  canvasAdminUpdateProject,
  canvasDownloadProjectUsage,
  canvasPrepareUpload,
  canvasListProjects,
  canvasCreateProject,
  canvasDeleteProject,
  canvasGetProject,
  canvasUpdateProject,
  canvasBatchGetAssetReviews,
  canvasBatchSubmitAssetReviews,
  canvasListCanvases,
  canvasCreateCanvas,
  canvasDeleteCanvas,
  canvasGetCanvas,
  canvasUpdateCanvas,
  canvasUpdateCanvasView,
  canvasGetGraph,
  canvasCreateNode,
  canvasUpdateNode,
  canvasDeleteNode,
  canvasBatchDeleteNodes,
  canvasUpdateNodePositions,
  canvasConnectNodes,
  canvasDeleteEdge,
  canvasReorderStoryboard,
  canvasStartGeneration,
  canvasStartNodeGeneration,
  canvasCancelNodeGeneration,
  canvasListNodeHistories,
  canvasSelectNodeHistory,
  canvasStartNodeAssetMatch,
  canvasCancelNodeAssetMatch,
  canvasSearchNodeAssets,
  canvasCopyNode,
  canvasCreateAsset,
  canvasMaterializeAssetReference,
  canvasMaterializeResourceReference,
  canvasStartStoryboardDrafts,
  canvasCancelStoryboardDrafts,
  canvasConfirmStoryboardDrafts,
  canvasListResources,
  canvasGetProjectResourceStats,
  canvasCreateResource,
  canvasCreateResourceFromAsset,
  canvasGetResource,
  canvasUpdateResource,
  canvasDeleteResource,
  canvasListResourceAssets,
  canvasCreateResourceAsset,
  canvasCreateGeneratedResourceAsset,
  canvasUpdateResourceAsset,
  canvasDeleteResourceAsset,
  canvasSetPrimaryResourceAsset,
  canvasReplaceResourceAsset,
  canvasGetResourceGeneration,
  canvasUpdateResourceGeneration,
  canvasStartResourceGeneration,
  canvasGetResourceGenerationRun,
  canvasCancelResourceGeneration,
  canvasBatchGetResourceGenerationStates,
  canvasBatchDeleteResourceAssets,
  canvasBatchDeleteResources,
  canvasBatchListResourceAssets,
  canvasListProjectModels,
  canvasListArchives,
  canvasCreateArchive,
  canvasGetArchive,
  canvasArchiveContent,
  canvasCancelArchive,
} = getCanvasService();

export async function prepareCanvasUpload(input: {
  clientRef: string;
  purpose: "source" | "cover";
  file: File;
}): Promise<AssetUploadPlan> {
  const plan = await canvasPrepareUpload({
    client_ref: input.clientRef,
    purpose: input.purpose,
    filename: input.file.name,
    media_type: input.file.type || "application/octet-stream",
    size_bytes: input.file.size,
  });
  return {
    uploadSessionId: plan.upload_session_id,
    intentId: plan.intent_id,
    state: plan.state as AssetUploadPlan["state"],
    uploadUrl: plan.upload_url,
    expiresAt: plan.expires_at,
    filename: plan.filename,
    mediaType: plan.media_type,
    sizeBytes: plan.size_bytes,
    assetId: plan.asset_id,
    revisionId: plan.revision_id,
  };
}

export async function fetchCanvasArchiveContent(
  projectId: string,
  canvasId: string,
  taskRunId: string,
  signal?: AbortSignal,
) {
  const path = `/api/canvas-server/projects/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}/archives/${encodeURIComponent(taskRunId)}/content`;
  const response = await authFetch(`${API_BASE_URL}${path}`, { signal });
  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  return response.blob();
}

export function createCanvasConversation(projectId: string, canvasId: string) {
  return getChatService().createCanvasConversation(
    { project_id: projectId, canvas_id: canvasId },
    { baseURL: "/api/chat-server" },
  );
}
