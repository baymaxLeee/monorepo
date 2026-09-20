import { getCanvasService } from "../generated/canvas-server/index";
import { getChatService } from "../generated/chat-server/index";
export type {
  CanvasGeneration,
  CanvasGraph,
  CanvasNode,
  CanvasEdge,
  CanvasBoard,
  CanvasProject,
  CanvasMutation,
} from "../generated/canvas-server/index";
export const {
  canvasUploadNode,
  canvasNodeContent,
  canvasStartGeneration,
  canvasListGenerations,
  canvasCancelGeneration,
  canvasApplyGeneration,
  canvasListProjects,
  canvasGetProject,
  canvasUpdateProject,
  canvasDeleteProject,
  canvasUpdateBoard,
  canvasDeleteBoard,
  canvasCreateProject,
  canvasListBoards,
  canvasCreateBoard,
  canvasGetGraph,
  canvasMutateGraph,
} = getCanvasService();
export function createCanvasConversation(canvasId: string) {
  return getChatService().createCanvasConversation({ canvas_id: canvasId }, { baseURL: "/api/chat-server" });
}
