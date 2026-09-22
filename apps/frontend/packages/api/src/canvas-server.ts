import { CanvasGenerationStatus, getCanvasService } from "../generated/canvas-server/index";
import { getChatService } from "../generated/chat-server/index";
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
  canvasBatchGetNodeStates,
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

export interface CanvasTextGenerationStreamState {
  taskRunId: string;
  status: CanvasGenerationStatus;
  content: string;
  errorCode?: string;
  errorMessage?: string;
}

interface TextGenerationSessionEvent {
  task_run_id: string;
  status: CanvasGenerationStatus;
  content: string;
  error_code?: string;
  error_message?: string;
}

interface TextGenerationDeltaEvent {
  delta: string;
}

interface TextGenerationCompletedEvent {
  task_run_id: string;
  content: string;
}

export async function streamCanvasNodeTextGeneration(
  projectId: string,
  canvasId: string,
  nodeId: string,
  signal: AbortSignal,
  onState: (state: CanvasTextGenerationStreamState) => void,
): Promise<CanvasTextGenerationStreamState | undefined> {
  const path = `/api/canvas-server/projects/${encodeURIComponent(projectId)}/canvases/${encodeURIComponent(canvasId)}/nodes/${encodeURIComponent(nodeId)}/text-generations:stream`;
  const response = await authFetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    signal,
    headers: { Accept: "text/event-stream" },
  });
  if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    throw new Error((await response.text()) || response.statusText);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let current: CanvasTextGenerationStreamState | undefined;
  let completed = false;
  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replaceAll("\r\n", "\n");
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = frame.match(/^event:\s*(.+)$/m)?.[1];
      const data = frame.match(/^data:\s*(.+)$/m)?.[1];
      if (!event || !data) continue;
      if (event === "session") {
        const session = JSON.parse(data) as TextGenerationSessionEvent;
        current = {
          taskRunId: session.task_run_id,
          status: session.status,
          content: session.content,
          errorCode: session.error_code,
          errorMessage: session.error_message,
        };
        onState(current);
      } else if (event === "delta" && current) {
        const delta = JSON.parse(data) as TextGenerationDeltaEvent;
        current = { ...current, content: current.content + delta.delta };
        onState(current);
      } else if (event === "completed") {
        const result = JSON.parse(data) as TextGenerationCompletedEvent;
        current = { taskRunId: result.task_run_id, status: CanvasGenerationStatus.SUCCEEDED, content: result.content };
        completed = true;
        onState(current);
      }
    }
    if (done) break;
  }
  if (
    !completed &&
    !signal.aborted &&
    current?.status !== CanvasGenerationStatus.FAILED &&
    current?.status !== CanvasGenerationStatus.CANCELLED
  ) {
    throw new Error("文本生成连接提前关闭");
  }
  return current;
}

export async function stageCanvasUpload(file: File, signal?: AbortSignal) {
  const response = await authFetch(`${API_BASE_URL}/api/canvas-server/uploads`, {
    method: "POST",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
    signal,
  });
  if (!response.ok) throw new Error((await response.text()) || response.statusText);
  return (await response.json()) as { blob_id: string; size_bytes: number };
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
