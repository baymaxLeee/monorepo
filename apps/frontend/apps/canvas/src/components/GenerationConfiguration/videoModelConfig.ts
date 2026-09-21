export interface GenerationSettings {
  model: string;
  resolution: string;
  ratio: string;
  duration: string;
  audio: string;
  watermark: string;
}

export interface VideoModelAssetLimits {
  image: number;
  video: number;
  audio: number;
}

export interface VideoModelCapabilityOption {
  id: string;
  name: string;
  durationMinSeconds?: number;
  durationMaxSeconds?: number;
  durationDefaultSeconds?: number;
  durationRecommendsSeconds?: readonly number[];
  durationRecommendDefaultSeconds?: number;
  ratioDefault?: string;
  ratios?: readonly string[];
  resolutionDefault?: string;
  resolutions?: readonly string[];
  audioDefault?: string;
  audios?: readonly string[];
  watermarkDefault?: string;
  watermarks?: readonly string[];
  assetLimits?: Partial<VideoModelAssetLimits>;
}

export interface VideoModelParamLimits {
  durationMinSeconds: number;
  durationMaxSeconds: number;
  durationDefaultSeconds: number;
  automaticDurationSupported: boolean;
  ratios: readonly string[];
  resolutions: readonly string[];
  audios: readonly string[];
  watermarks: readonly string[];
  assets: VideoModelAssetLimits;
}

export interface VideoModelParamConfig {
  modelId: string;
  defaults: Omit<GenerationSettings, "model">;
  limits: VideoModelParamLimits;
}

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  model: "",
  resolution: "",
  ratio: "",
  duration: "",
  audio: "",
  watermark: "",
};

function uniqueValues(values?: readonly string[], normalize = false) {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => (normalize ? value.toUpperCase() : value)),
    ),
  ];
}

function allowedDefault(preferred: string | undefined, options: readonly string[]) {
  return preferred && options.includes(preferred) ? preferred : (options[0] ?? "");
}

function durationLimits(option?: VideoModelCapabilityOption) {
  const min = Number(option?.durationMinSeconds);
  const max = Number(option?.durationMaxSeconds);
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min ? { min, max } : { min: 0, max: 0 };
}

function supportsAutomaticDuration(option?: VideoModelCapabilityOption) {
  return (option?.durationRecommendsSeconds ?? []).some((value) => Number(value) === -1);
}

function manualDurationDefault(option: VideoModelCapabilityOption | undefined, min: number, max: number) {
  if (min === 0) return 0;
  const candidates = [
    option?.durationDefaultSeconds,
    option?.durationRecommendDefaultSeconds,
    ...(option?.durationRecommendsSeconds ?? []),
  ];
  const preferred = candidates.map(Number).find((value) => Number.isFinite(value) && value > 0);
  return Math.min(max, Math.max(min, preferred ?? min));
}

function assetLimits(option?: VideoModelCapabilityOption) {
  const value = (category: keyof VideoModelAssetLimits) => {
    const limit = Number(option?.assetLimits?.[category]);
    return Number.isFinite(limit) && limit >= 0 ? limit : 0;
  };
  return {
    image: value("image"),
    video: value("video"),
    audio: value("audio"),
  };
}

/** 参数面板完全由模型管理下发的 Property.Vision.Video 能力构造。 */
export function getVideoModelParamConfigByOption(
  modelId: string | undefined,
  modelOptions: ReadonlyArray<VideoModelCapabilityOption>,
): VideoModelParamConfig {
  const option = modelOptions.find((item) => item.id === modelId);
  const ratios = uniqueValues(option?.ratios);
  const resolutions = uniqueValues(option?.resolutions, true);
  const audios = uniqueValues(option?.audios);
  const watermarks = uniqueValues(option?.watermarks);
  const duration = durationLimits(option);
  const automaticDurationSupported = supportsAutomaticDuration(option);
  const durationDefault = manualDurationDefault(option, duration.min, duration.max);
  const defaultDuration = automaticDurationSupported ? "-1s" : durationDefault > 0 ? `${durationDefault}s` : "";
  return {
    modelId: option?.id ?? "",
    defaults: {
      ratio: ratios.includes("adaptive") ? "adaptive" : allowedDefault(option?.ratioDefault, ratios),
      resolution: allowedDefault(option?.resolutionDefault?.trim().toUpperCase(), resolutions),
      duration: defaultDuration,
      audio: allowedDefault(option?.audioDefault, audios),
      watermark: allowedDefault(option?.watermarkDefault, watermarks),
    },
    limits: {
      durationMinSeconds: duration.min,
      durationMaxSeconds: duration.max,
      durationDefaultSeconds: durationDefault,
      automaticDurationSupported,
      ratios,
      resolutions,
      audios,
      watermarks,
      assets: assetLimits(option),
    },
  };
}

function pickAllowed(value: string, options: readonly string[], fallback: string) {
  if (options.length === 0) return value;
  return options.includes(value) ? value : fallback;
}

/** 切模型或应用配置时，把当前参数收敛到模型管理下发的可选范围内。 */
export function sanitizeGenerationSettings(
  settings: GenerationSettings,
  config: VideoModelParamConfig,
): GenerationSettings {
  const { defaults, limits } = config;
  const parsedDuration = Number.parseInt(settings.duration, 10);
  const hasValidManualDuration = Number.isFinite(parsedDuration) && parsedDuration > 0;
  const hasDuration = limits.durationMinSeconds > 0 && limits.durationMaxSeconds >= limits.durationMinSeconds;
  const duration =
    limits.automaticDurationSupported && (settings.duration === "-1s" || !hasValidManualDuration || !hasDuration)
      ? "-1s"
      : hasDuration
        ? `${Math.min(
            limits.durationMaxSeconds,
            Math.max(
              limits.durationMinSeconds,
              hasValidManualDuration ? parsedDuration : limits.durationDefaultSeconds,
            ),
          )}s`
        : settings.duration;
  return {
    model: settings.model,
    ratio: pickAllowed(settings.ratio, limits.ratios, defaults.ratio),
    resolution: pickAllowed(settings.resolution, limits.resolutions, defaults.resolution),
    duration,
    audio: pickAllowed(settings.audio, limits.audios, defaults.audio),
    watermark: pickAllowed(settings.watermark, limits.watermarks, defaults.watermark),
  };
}
