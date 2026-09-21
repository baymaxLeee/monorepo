/** 生图模型能力与参数组合约束，仅供生成配置域使用。 */
export interface NumericRange {
  min?: number;
  max?: number;
}

export interface ImageGenerationCapabilities {
  width: NumericRange;
  height: NumericRange;
  ratio: NumericRange;
  totalPixels: NumericRange;
  watermarkSupported: boolean;
  watermarkEnabled: boolean;
}

export interface ImageModelParamOption {
  id: string;
  name: string;
  capabilities: ImageGenerationCapabilities;
  referenceImageLimit?: number;
  supportsImageToImage?: boolean;
  supportsTextToImage?: boolean;
}

/** 所有生图入口共享同一候选集合，最终可选项统一由当前模型能力过滤。 */
export const IMAGE_PARAMETER_OPTIONS = {
  ratios: ["1:1", "3:4", "4:3", "9:16", "16:9", "3:2", "2:3", "21:9"],
  resolutions: ["480P", "720P", "1080P", "2K", "4K"],
};

export function imageDimensions(resolution: string, ratio: string): [number, number] | undefined {
  const shortEdge = {
    "480P": 480,
    "720P": 720,
    "1080P": 1080,
    "2K": 1440,
    "4K": 2160,
  }[resolution];
  const [widthRatio, heightRatio] = ratio.split(":").map(Number);
  if (!shortEdge || !widthRatio || !heightRatio) return undefined;
  return widthRatio >= heightRatio
    ? [Math.floor((shortEdge * widthRatio) / heightRatio), shortEdge]
    : [shortEdge, Math.floor((shortEdge * heightRatio) / widthRatio)];
}

function outside(value: number, range: NumericRange) {
  return (range.min !== undefined && value < range.min) || (range.max !== undefined && value > range.max);
}

export function validateImageGenerationSettings(
  model: ImageModelParamOption,
  resolution: string,
  ratio: string,
): string | undefined {
  const capabilities = model.capabilities;
  const hasSizeCapabilities =
    Object.keys(capabilities.width).length > 0 ||
    Object.keys(capabilities.height).length > 0 ||
    Object.keys(capabilities.ratio).length > 0 ||
    Object.keys(capabilities.totalPixels).length > 0;
  if (!hasSizeCapabilities) return "当前模型未配置图片尺寸能力";
  const dimensions = imageDimensions(resolution, ratio);
  if (!dimensions) return "图片分辨率或比例不合法";
  const [width, height] = dimensions;
  if (
    outside(width, capabilities.width) ||
    outside(height, capabilities.height) ||
    outside(width / height, capabilities.ratio)
  ) {
    return `当前模型不支持 ${width}×${height} 图片尺寸`;
  }
  const totalPixels = width * height;
  if (outside(totalPixels, capabilities.totalPixels)) {
    if (capabilities.totalPixels.max !== undefined && totalPixels > capabilities.totalPixels.max) {
      return `当前模型最大支持 ${capabilities.totalPixels.max} 像素，请降低分辨率或调整比例`;
    }
    return `当前模型不支持 ${width}×${height} 图片尺寸`;
  }
  return undefined;
}

export interface ImageGenerationOptionAvailability {
  resolutions: string[];
  ratios: string[];
  disabledResolutions: string[];
  disabledRatios: string[];
}

function supportsCombination(model: ImageModelParamOption, resolution: string, ratio: string) {
  return validateImageGenerationSettings(model, resolution, ratio) === undefined;
}

export function imageGenerationOptionAvailability(
  model: ImageModelParamOption,
  resolutionCandidates: readonly string[],
  ratioCandidates: readonly string[],
  resolution: string,
  ratio: string,
): ImageGenerationOptionAvailability {
  const resolutions = resolutionCandidates.filter((candidate) =>
    ratioCandidates.some((ratioCandidate) => supportsCombination(model, candidate, ratioCandidate)),
  );
  const ratios = ratioCandidates.filter((candidate) =>
    resolutionCandidates.some((resolutionCandidate) => supportsCombination(model, resolutionCandidate, candidate)),
  );
  return {
    resolutions,
    ratios,
    disabledResolutions: resolutions.filter((candidate) => !supportsCombination(model, candidate, ratio)),
    disabledRatios: ratios.filter((candidate) => !supportsCombination(model, resolution, candidate)),
  };
}

export function normalizeImageGenerationSettings(
  model: ImageModelParamOption,
  resolutionCandidates: readonly string[],
  ratioCandidates: readonly string[],
  settings: { resolution: string; ratio: string },
  preferred: "resolution" | "ratio",
): { resolution: string; ratio: string } | undefined {
  const availability = imageGenerationOptionAvailability(
    model,
    resolutionCandidates,
    ratioCandidates,
    settings.resolution,
    settings.ratio,
  );
  if (preferred === "resolution") {
    const resolutions = [
      settings.resolution,
      ...availability.resolutions.filter((item) => item !== settings.resolution),
    ];
    for (const resolution of resolutions) {
      const ratios = [settings.ratio, ...availability.ratios.filter((item) => item !== settings.ratio)];
      const ratio = ratios.find((candidate) => supportsCombination(model, resolution, candidate));
      if (ratio) return { resolution, ratio };
    }
    return undefined;
  }
  const ratios = [settings.ratio, ...availability.ratios.filter((item) => item !== settings.ratio)];
  for (const ratio of ratios) {
    const resolutions = [
      settings.resolution,
      ...availability.resolutions.filter((item) => item !== settings.resolution),
    ];
    const resolution = resolutions.find((candidate) => supportsCombination(model, candidate, ratio));
    if (resolution) return { resolution, ratio };
  }
  return undefined;
}
