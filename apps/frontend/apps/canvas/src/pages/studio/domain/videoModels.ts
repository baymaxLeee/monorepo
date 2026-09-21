import { listGrantedProjectModelDetails } from "@/api";
import type { VideoModelCapabilityOption } from "@/components/GenerationConfiguration/videoModelConfig";
import type { project } from "@/domain";

import { type ImageGenerationModelOption, imageGenerationModelOption } from "../../resources/generation/imageModels";

export type VideoModelOption = VideoModelCapabilityOption;

const MODEL_TYPE_VISION = "vision";
const MODEL_TYPE_TEXT = "text-generation";
const FEATURE_TEXT_TO_VIDEO = "text2video";
const FEATURE_TOOL_CALL = "tool-call";
const SWITCH_ENABLED = "enabled";
const SWITCH_DISABLED = "disabled";

function modelOption(model: project.ProjectModelInfo): VideoModelOption {
  const video = model.Property?.Vision?.Video;
  const referenceLimit = (kind: "Audio" | "Image" | "Video") => {
    const reference = video?.Reference?.[kind];
    return reference?.Supported === false ? 0 : reference?.Max;
  };
  const audioTypes = video?.GenerateAudio?.Types ?? [];
  const ratios = [...(video?.Ratio?.Adaptive ? ["adaptive"] : []), ...(video?.Ratio?.Values ?? [])];
  return {
    id: model.ID,
    name: model.Name || model.ID,
    durationMinSeconds: video?.Duration?.Min,
    durationMaxSeconds: video?.Duration?.Max,
    durationDefaultSeconds: video?.Duration?.Default,
    durationRecommendsSeconds: video?.Duration?.Recommends,
    durationRecommendDefaultSeconds: video?.Duration?.RecommendDefault,
    ratioDefault: video?.Ratio?.Default,
    ratios: [...new Set(ratios)],
    resolutions: video?.Resolutions,
    audioDefault:
      video?.GenerateAudio?.Default === SWITCH_ENABLED
        ? "有声"
        : video?.GenerateAudio?.Default === SWITCH_DISABLED
          ? "无声"
          : undefined,
    audios: [
      ...(audioTypes.includes(SWITCH_ENABLED) ? ["有声"] : []),
      ...(audioTypes.includes(SWITCH_DISABLED) ? ["无声"] : []),
    ],
    watermarkDefault: video?.Watermark?.Enabled ? "有水印" : "无水印",
    watermarks: video?.Watermark ? (video.Watermark.Supported ? ["无水印", "有水印"] : ["无水印"]) : [],
    assetLimits: {
      audio: referenceLimit("Audio"),
      image: referenceLimit("Image"),
      video: referenceLimit("Video"),
    },
  };
}

export interface StudioModelOptions {
  image: ImageGenerationModelOption[];
  text: VideoModelOption[];
  video: VideoModelOption[];
  storyboard: VideoModelOption[];
}

/** 创意工坊顶层一次拉取全部所需模型，再按类型和能力拆分给各消费模块。 */
export async function listStudioModels(projectId: string): Promise<StudioModelOptions> {
  const models = await listGrantedProjectModelDetails(projectId, {
    Types: [MODEL_TYPE_VISION, MODEL_TYPE_TEXT],
    Statuses: ["Running"],
  });
  const visionModels = models.filter((model) => model.Type === MODEL_TYPE_VISION);
  const textModels = models.filter((model) => model.Type === MODEL_TYPE_TEXT);
  return {
    image: visionModels
      .map(imageGenerationModelOption)
      .filter((option): option is ImageGenerationModelOption => Boolean(option)),
    text: textModels.map(modelOption),
    video: visionModels.filter((model) => model.FeaturesConfig?.includes(FEATURE_TEXT_TO_VIDEO)).map(modelOption),
    storyboard: textModels.filter((model) => model.FeaturesConfig?.includes(FEATURE_TOOL_CALL)).map(modelOption),
  };
}

export function videoModelLabel(modelId: string, options: VideoModelOption[]): string {
  return options.find((item) => item.id === modelId)?.name ?? modelId;
}
