export interface ScriptDurationRange {
  min: number;
  max: number;
}

const SHOT_DURATION_LIMIT_MIN_SECONDS = 4;
const SHOT_DURATION_LIMIT_MAX_SECONDS = 15;
const VIDEO_DURATION_MIN_MINUTES = 1;
const VIDEO_DURATION_MAX_MINUTES = 50;

export const DEFAULT_SHOT_DURATION_RANGE: ScriptDurationRange = {
  min: SHOT_DURATION_LIMIT_MIN_SECONDS,
  max: SHOT_DURATION_LIMIT_MAX_SECONDS,
};

export const DEFAULT_VIDEO_DURATION_RANGE: ScriptDurationRange = {
  min: VIDEO_DURATION_MIN_MINUTES,
  max: VIDEO_DURATION_MAX_MINUTES,
};

export function storyboardShotDurationLimits(option?: {
  durationMinSeconds?: number;
  durationMaxSeconds?: number;
}): ScriptDurationRange {
  const min = Number(option?.durationMinSeconds);
  const max = Number(option?.durationMaxSeconds);
  return Number.isFinite(min) && Number.isFinite(max) && min > 0 && max >= min
    ? { min, max }
    : { ...DEFAULT_SHOT_DURATION_RANGE };
}
