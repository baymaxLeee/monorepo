import { getCanvasService } from "../generated/canvas-server/index";

export type { CanvasAssetMatchRun, CanvasStartAssetMatch } from "../generated/canvas-server/index";

export const { canvasStartAssetMatch, canvasGetAssetMatch, canvasCancelAssetMatch } = getCanvasService();
