
export const SEGMENT_SECONDS_MIN = 4;
export const SEGMENT_SECONDS_MAX = 15;

export const SEGMENT_SECONDS_TARGET = 12;

export const MAX_SEGMENTS = 12;
export const MIN_SEGMENTS = 2;

export const MAX_MAIN_CHARACTERS = 3;

export const DEFAULT_TARGET_DURATION_S = 50;
export const MIN_TARGET_DURATION_S = 4;
export const MAX_TARGET_DURATION_S = 120;

export const ARK_DURATION_MIN = 4;
export const ARK_DURATION_MAX = 15;

export function clampSegmentSeconds(value: number | undefined, max = SEGMENT_SECONDS_MAX): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : SEGMENT_SECONDS_TARGET;
  return Math.min(max, Math.max(SEGMENT_SECONDS_MIN, n));
}

export function clampArkDuration(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : SEGMENT_SECONDS_TARGET;
  return Math.min(ARK_DURATION_MAX, Math.max(ARK_DURATION_MIN, n));
}

export function deriveSegmentCount(targetDurationSec: number): number {
  const raw = Math.round(targetDurationSec / SEGMENT_SECONDS_TARGET);
  return Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, raw));
}

export function perSegmentSeconds(targetDurationSec: number, count: number): number {
  const safeCount = Math.max(1, count);
  return clampSegmentSeconds(Math.round(targetDurationSec / safeCount));
}

export type ScriptedSegmentDurationInput = {
  seconds?: number;
};

export function scriptedSegmentSeconds(
  targetDurationSec: number | undefined,
  segments: readonly ScriptedSegmentDurationInput[],
): number[] {
  if (!segments.length) return [];
  return segments.map((segment) => {
    if (segment.seconds != null) return clampArkDuration(segment.seconds);
    if (targetDurationSec == null) return SEGMENT_SECONDS_TARGET;
    return clampArkDuration(Math.round(targetDurationSec / segments.length));
  });
}

export function randomBaseSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function deriveSegmentSeed(baseSeed: number, order: number): number {
  return (baseSeed + order * 2_654_435_761) % 2 ** 31;
}
