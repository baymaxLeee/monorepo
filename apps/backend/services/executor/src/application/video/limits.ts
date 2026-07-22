
export const SEGMENT_SECONDS_TARGET = 12;

export const MAX_SEGMENTS = 12;

export const MAX_MAIN_CHARACTERS = 3;

export const MIN_TARGET_DURATION_S = 4;
export const MAX_TARGET_DURATION_S = 120;

export const ARK_DURATION_MIN = 4;
export const ARK_DURATION_MAX = 15;

export function clampArkDuration(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : SEGMENT_SECONDS_TARGET;
  return Math.min(ARK_DURATION_MAX, Math.max(ARK_DURATION_MIN, n));
}

export function randomBaseSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function deriveSegmentSeed(baseSeed: number, order: number): number {
  return (baseSeed + order * 2_654_435_761) % 2 ** 31;
}
