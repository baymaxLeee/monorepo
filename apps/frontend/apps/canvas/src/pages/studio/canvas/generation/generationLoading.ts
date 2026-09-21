import { canvasnode } from "@/domain";

type GenerationLoadingState = {
  activeTaskRunID?: string;
  isTextGenerationWaiting: boolean;
  type: canvasnode.CanvasNodeType;
};

type GenerationPreviewState = {
  hasOutput: boolean;
  isLoading: boolean;
};

export function generationPreviewMode({
  hasOutput,
  isLoading,
}: GenerationPreviewState): "empty" | "loading" | "output" {
  if (isLoading) return "loading";
  return hasOutput ? "output" : "empty";
}

export function shouldShowGenerationLoadingBackground({
  activeTaskRunID,
  isTextGenerationWaiting,
  type,
}: GenerationLoadingState): boolean {
  if (type === canvasnode.CanvasNodeType.TEXT_GENERATION) {
    return isTextGenerationWaiting;
  }

  return (
    Boolean(activeTaskRunID) &&
    (type === canvasnode.CanvasNodeType.IMAGE_GENERATION || type === canvasnode.CanvasNodeType.VIDEO_GENERATION)
  );
}
