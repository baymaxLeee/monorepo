import { canvasListProjectModels, type CanvasProjectModelInfo } from "@repo/api";

import type { project } from "@/domain";

type GrantedProjectModelFilter = Omit<project.ProjectModelFilter, "IsGranted">;

function present(value: CanvasProjectModelInfo): project.ProjectModelInfo {
  return {
    ID: value.id,
    Name: value.name,
    Type: value.type,
    FeaturesConfig: value.features_config,
    Status: value.status,
    IsPublic: value.is_public,
    IsDefault: value.is_default,
    Granted: value.granted,
    Property: value.property?.vision?.video
      ? {
          Vision: {
            Video: {
              Duration: value.property.vision.video.duration
                ? {
                    Min: value.property.vision.video.duration.min,
                    Max: value.property.vision.video.duration.max,
                    Default: value.property.vision.video.duration.default,
                    Recommends: value.property.vision.video.duration.recommends,
                    RecommendDefault: value.property.vision.video.duration.recommend_default,
                  }
                : undefined,
              Ratio: value.property.vision.video.ratio
                ? {
                    Values: value.property.vision.video.ratio.values,
                    Adaptive: value.property.vision.video.ratio.adaptive,
                    Default: value.property.vision.video.ratio.default,
                  }
                : undefined,
              Resolutions: value.property.vision.video.resolutions,
            },
          },
        }
      : undefined,
    Description: value.description,
    ModelName: value.model_name,
    Provider: value.provider,
  };
}

export async function listGrantedProjectModels(
  projectId: string,
  filter: GrantedProjectModelFilter = {},
): Promise<project.ProjectModelInfo[]> {
  const pageSize = 100;
  const values: CanvasProjectModelInfo[] = [];
  for (let pageNum = 1; ; pageNum += 1) {
    const response = await canvasListProjectModels(projectId, { page_num: pageNum, page_size: pageSize });
    values.push(...response.items);
    if (response.items.length === 0 || values.length >= response.total) break;
  }
  return values
    .map(present)
    .filter(
      (model) =>
        (!filter.Types?.length || filter.Types.includes(model.Type)) &&
        (!filter.Statuses?.length || filter.Statuses.includes(model.Status ?? "")) &&
        (!filter.Features?.length || filter.Features.some((feature) => model.FeaturesConfig?.includes(feature))),
    );
}

export const listGrantedProjectModelDetails = listGrantedProjectModels;
