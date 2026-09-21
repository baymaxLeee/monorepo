import { getCanvasService } from "../generated/canvas-server/index";
export type { CanvasNodeFrames, CanvasCanvasView } from "../generated/canvas-server/index";
export const {
  canvasCopyNode,
  canvasResourceFromNode,
  canvasGetView,
  canvasSaveView,
  canvasCopyAsset,
  canvasNodeFrames,
} = getCanvasService();
