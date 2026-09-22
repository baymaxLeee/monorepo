import { listGrantedProjectModelDetails } from "@/api";
import type { ImageGenerationCapabilities, NumericRange } from "@/components/GenerationConfiguration/imageModelConfig";
import type { project } from "@/domain";

export interface ImageGenerationModelOption {
  id: string;
  name: string;
  supportsTextToImage: boolean;
  supportsImageToImage: boolean;
  referenceImageLimit: number;
  capabilities: ImageGenerationCapabilities;
}

const IMAGE_GENERATION_FEATURES = ["text2image", "image2image"] as const;

function normalizeRange(raw?: { Min?: number; Max?: number }): NumericRange {
  const min = Number(raw?.Min);
  const max = Number(raw?.Max);
  return {
    ...(Number.isFinite(min) && min > 0 ? { min } : {}),
    ...(Number.isFinite(max) && max > 0 ? { max } : {}),
  };
}

function imageCapabilities(raw?: Pick<project.ProjectModelInfo, "Property">): ImageGenerationCapabilities {
  const image = raw?.Property?.Vision?.Image;
  return {
    width: normalizeRange(image?.HW?.Width),
    height: normalizeRange(image?.HW?.Height),
    ratio: normalizeRange(image?.HW?.Ratio),
    totalPixels: normalizeRange(image?.HW?.Total),
    watermarkSupported: image?.Watermark?.Supported === true,
    watermarkEnabled: image?.Watermark?.Enabled === true,
  };
}

export function imageGenerationModelOption(
  model: Pick<project.ProjectModelInfo, "ID" | "Name"> &
    Partial<Pick<project.ProjectModelInfo, "FeaturesConfig" | "Property">>,
): ImageGenerationModelOption | undefined {
  const features = model.FeaturesConfig ?? [];
  const supportsTextToImage = features.includes(IMAGE_GENERATION_FEATURES[0]);
  const supportsImageToImage = features.includes(IMAGE_GENERATION_FEATURES[1]);
  if (!supportsTextToImage && !supportsImageToImage) return undefined;
  return {
    id: model.ID,
    name: model.Name || model.ID,
    supportsTextToImage,
    supportsImageToImage,
    referenceImageLimit: supportsImageToImage
      ? (model.Property?.Vision?.Image?.ImageToImage?.InputConfig?.Max ?? 1)
      : 0,
    capabilities: imageCapabilities(model.Property ? { Property: model.Property } : undefined),
  };
}

/**
 * 拉取当前项目已授权且可用的图片生成模型。Provider 对 Features 数组按任一能力匹配，
 * 因而文生图、图生图及同时支持两者的模型可以在一次请求中返回。
 */
export async function listImageGenerationModels(projectId: string): Promise<ImageGenerationModelOption[]> {
  const models = await listGrantedProjectModelDetails(projectId, {
    Types: ["vision"],
    Features: [...IMAGE_GENERATION_FEATURES],
    Statuses: ["Running"],
  });
  return models
    .map(imageGenerationModelOption)
    .filter((option): option is ImageGenerationModelOption => Boolean(option));
}
