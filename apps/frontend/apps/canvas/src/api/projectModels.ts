import { canvasListProjectModels, type CanvasProjectModelInfo } from "@repo/api";

import type { project } from "@/domain";

type GrantedProjectModelFilter = Omit<project.ProjectModelFilter, "IsGranted">;

function present(value: CanvasProjectModelInfo): project.ProjectModelInfo {
  const vision = value.property?.vision;
  return {
    ID: value.id,
    Name: value.name,
    Type: value.type,
    FeaturesConfig: value.features_config,
    Status: value.status,
    IsPublic: value.is_public,
    IsDefault: value.is_default,
    Granted: value.granted,
    Property: vision
      ? {
          Vision: {
            Video: vision.video
              ? {
                  Duration: vision.video.duration
                    ? {
                        Min: vision.video.duration.min,
                        Max: vision.video.duration.max,
                        Default: vision.video.duration.default,
                        Recommends: vision.video.duration.recommends,
                        RecommendDefault: vision.video.duration.recommend_default,
                      }
                    : undefined,
                  Ratio: vision.video.ratio
                    ? {
                        Values: vision.video.ratio.values,
                        Adaptive: vision.video.ratio.adaptive,
                        Default: vision.video.ratio.default,
                      }
                    : undefined,
                  Resolutions: vision.video.resolutions,
                  GenerateAudio: vision.video.generate_audio
                    ? {
                        Types: vision.video.generate_audio.types,
                        Default: vision.video.generate_audio.default,
                      }
                    : undefined,
                  Watermark: vision.video.watermark
                    ? {
                        Supported: vision.video.watermark.supported,
                        Enabled: vision.video.watermark.enabled,
                      }
                    : undefined,
                  Reference: vision.video.reference
                    ? {
                        Image: vision.video.reference.image
                          ? {
                              Supported: vision.video.reference.image.supported,
                              Max: vision.video.reference.image.max,
                            }
                          : undefined,
                        Video: vision.video.reference.video
                          ? {
                              Supported: vision.video.reference.video.supported,
                              Max: vision.video.reference.video.max,
                            }
                          : undefined,
                        Audio: vision.video.reference.audio
                          ? {
                              Supported: vision.video.reference.audio.supported,
                              Max: vision.video.reference.audio.max,
                            }
                          : undefined,
                      }
                    : undefined,
                }
              : undefined,
            Image: vision.image
              ? {
                  ImageToImage: vision.image.image_to_image
                    ? {
                        InputConfig: vision.image.image_to_image.input_config
                          ? {
                              Min: vision.image.image_to_image.input_config.min,
                              Max: vision.image.image_to_image.input_config.max,
                            }
                          : undefined,
                      }
                    : undefined,
                  HW: vision.image.hw
                    ? {
                        Width: vision.image.hw.width
                          ? { Min: vision.image.hw.width.min, Max: vision.image.hw.width.max }
                          : undefined,
                        Height: vision.image.hw.height
                          ? { Min: vision.image.hw.height.min, Max: vision.image.hw.height.max }
                          : undefined,
                        Ratio: vision.image.hw.ratio
                          ? { Min: vision.image.hw.ratio.min, Max: vision.image.hw.ratio.max }
                          : undefined,
                        Total: vision.image.hw.total
                          ? { Min: vision.image.hw.total.min, Max: vision.image.hw.total.max }
                          : undefined,
                      }
                    : undefined,
                  Watermark: vision.image.watermark
                    ? {
                        Supported: vision.image.watermark.supported,
                        Enabled: vision.image.watermark.enabled,
                      }
                    : undefined,
                }
              : undefined,
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
