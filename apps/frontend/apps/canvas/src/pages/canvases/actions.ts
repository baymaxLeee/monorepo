import type { canvas } from "@/domain";

export interface CanvasFormValues {
  Name: string;
  CoverImagePath?: string;
}

export type CanvasDialogState = { mode: "create" } | { mode: "edit"; canvas: canvas.ProjectCanvasSummary };

interface CanvasMutationService {
  CreateProjectCanvas(request: canvas.CreateProjectCanvasRequest): Promise<canvas.CreateProjectCanvasResponse>;
  UpdateProjectCanvas(request: canvas.UpdateProjectCanvasRequest): Promise<canvas.UpdateProjectCanvasResponse>;
  DeleteProjectCanvas(request: canvas.DeleteProjectCanvasRequest): Promise<unknown>;
}

interface CanvasQueryService {
  GetProjectCanvas(request: canvas.GetProjectCanvasRequest): Promise<canvas.GetProjectCanvasResponse>;
}

export async function getCanvas(service: CanvasQueryService, projectId: string, canvasId: string) {
  const response = await service.GetProjectCanvas({
    ProjectID: projectId,
    CanvasID: canvasId,
  });
  return response.Canvas;
}

export function saveCanvas(
  service: CanvasMutationService,
  projectId: string,
  state: CanvasDialogState,
  values: CanvasFormValues,
) {
  if (state.mode === "edit") {
    return service.UpdateProjectCanvas({
      ProjectID: projectId,
      CanvasID: state.canvas.CanvasID,
      Name: values.Name,
      CoverImagePath: values.CoverImagePath ?? "",
    });
  }

  return service.CreateProjectCanvas({
    ProjectID: projectId,
    Name: values.Name,
    CoverImagePath: values.CoverImagePath || undefined,
  });
}

export function deleteCanvas(service: CanvasMutationService, projectId: string, canvasId: string) {
  return service.DeleteProjectCanvas({
    ProjectID: projectId,
    CanvasID: canvasId,
  });
}
