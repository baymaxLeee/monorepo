import { canvasCreateCanvas, canvasDeleteCanvas, canvasGetCanvas, canvasUpdateCanvas } from "@repo/api";

import type { canvas } from "@/domain";

export interface CanvasFormValues {
  Name: string;
  CoverImage?: { assetId: string; revisionId: string };
}

export type CanvasDialogState = { mode: "create" } | { mode: "edit"; canvas: canvas.ProjectCanvasSummary };

function canvasFromDTO(value: Awaited<ReturnType<typeof canvasGetCanvas>>["canvas"]): canvas.ProjectCanvasSummary {
  return {
    CanvasID: value.canvas_id,
    ProjectID: value.project_id,
    Name: value.name,
    CoverImageAssetID: value.cover_image_asset_id,
    CoverImageRevisionID: value.cover_image_revision_id,
    CoverImageURL: value.cover_image_url,
    CreatedBy: value.created_by,
    CreatedAt: value.created_at,
    UpdatedAt: value.updated_at,
    Stats: {
      CanvasNodeCount: value.stats.canvas_node_count,
      SelectedVideoDurationMillis: value.stats.selected_video_duration_millis,
    },
    FallbackCoverImageURL: value.fallback_cover_image_url,
    DefaultView: value.default_view,
    Revision: value.revision,
  };
}

export async function getCanvas(projectId: string, canvasId: string) {
  return canvasFromDTO((await canvasGetCanvas(projectId, canvasId)).canvas);
}

export async function saveCanvas(projectId: string, state: CanvasDialogState, values: CanvasFormValues) {
  if (state.mode === "edit") {
    return canvasFromDTO(
      (
        await canvasUpdateCanvas(projectId, state.canvas.CanvasID, {
          name: values.Name,
          cover_image_asset_id: values.CoverImage?.assetId,
          cover_image_revision_id: values.CoverImage?.revisionId,
        })
      ).canvas,
    );
  }
  return canvasFromDTO(
    (
      await canvasCreateCanvas(projectId, {
        name: values.Name,
        cover_image_asset_id: values.CoverImage?.assetId || undefined,
        cover_image_revision_id: values.CoverImage?.revisionId || undefined,
      })
    ).canvas,
  );
}

export function deleteCanvas(projectId: string, canvasId: string) {
  return canvasDeleteCanvas(projectId, canvasId);
}
