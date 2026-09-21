import { canvasnode } from "@/domain";

export interface CanvasGenerationRuntimeState {
  status: canvasnode.CanvasGenerationStatus;
  taskRunId: string;
  providerStatus?: canvasnode.CanvasNodeVideoProviderStatus;
}

export function videoProviderStatusForRun(
  states: ReadonlyMap<string, CanvasGenerationRuntimeState>,
  nodeId?: string,
  taskRunId?: string,
) {
  if (!nodeId || !taskRunId) return undefined;
  const state = states.get(nodeId);
  return state?.taskRunId === taskRunId ? state.providerStatus : undefined;
}

export function isVideoGenerationCancellationAllowed(status?: canvasnode.CanvasNodeVideoProviderStatus) {
  // Old servers omit this field; let the cancellation endpoint decide instead
  // of treating TaskRun RUNNING as a provider observation.
  return (
    status === undefined ||
    status === canvasnode.CanvasNodeVideoProviderStatus.PENDING ||
    status === canvasnode.CanvasNodeVideoProviderStatus.QUEUED
  );
}

export function isVideoGenerationCancellationDisabled(status?: canvasnode.CanvasNodeVideoProviderStatus) {
  return (
    status === canvasnode.CanvasNodeVideoProviderStatus.RUNNING ||
    status === canvasnode.CanvasNodeVideoProviderStatus.SUCCEEDED
  );
}
