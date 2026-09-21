import { getCanvasService } from "../generated/canvas-server/index";

export type { CanvasProjectManagement, CanvasProjectUsage } from "../generated/canvas-server/index";
export const {
  canvasProjectManagement,
  canvasUpdateProjectMembers,
  canvasProjectUsage,
  canvasUpdateProjectUsageLimit,
  canvasProjectUsageWorkbook,
} = getCanvasService();
