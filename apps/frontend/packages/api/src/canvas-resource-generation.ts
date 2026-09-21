import { getCanvasService } from "../generated/canvas-server/index";
export type { CanvasResourceGenerationDraft, CanvasResourceGenerationConfig } from "../generated/canvas-server/index";
export const {
  canvasCreateGeneratedResourceAsset,
  canvasGetResourceGeneration,
  canvasUpdateResourceGeneration,
  canvasStartResourceGeneration,
  canvasListResourceGenerationRuns,
  canvasCancelResourceGeneration,
} = getCanvasService();
