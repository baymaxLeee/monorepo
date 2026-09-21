import { getCanvasService } from "../generated/canvas-server/index";

export type {
  CanvasProjectManagement,
  CanvasProjectProvider,
  CanvasProjectUsage,
} from "../generated/canvas-server/index";
export const {
  canvasProjectManagement,
  canvasUpdateProjectMembers,
  canvasUpdateProjectModels,
  canvasProjectProviders,
  canvasProjectUsage,
  canvasUpdateProjectUsageLimit,
  canvasProjectUsageWorkbook,
} = getCanvasService();
