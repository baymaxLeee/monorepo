// Pure planning constants + helpers for the short-drama video pipeline.
// Deliberately free of any `ai` / Node import so it is safe to import from the
// "use workflow" orchestrator AND from both planning steps (ADR-0018).
//
// Model shape (2026-07 revision): ONE segment == ONE story beat == ONE Seedance
// generation == ONE continuous, forward-progressing action. We deliberately do
// NOT subdivide a segment into multiple in-prompt shots anymore: a single beat is
// one event, and asking the model to "cover" it from several angles is what
// produced 块内剧情重复 (the same moment re-shot). Cut density instead comes from
// MORE short segments hard-cut together — the proven 投流 shape. Cross-segment
// distinctness is the script's job (distinct beats); within-segment repetition is
// now structurally impossible (there is only one action).

// One segment's clip length. Kept in the 4–8s "sweet spot": long enough to read
// as a real beat, short enough that a single continuous action never runs out of
// motion and starts looping / decaying (the old 镜头重复 bug on >8s single-prompt
// clips). 4s is Seedance's hard floor; we cap the planner at 12s so even a very
// long target never asks one generation to sustain one action past the sweet
// spot. The wire layer (ark.ts) clamps again to the model's real 4–15 ceiling.
export const SEGMENT_SECONDS_MIN = 4;
export const SEGMENT_SECONDS_MAX = 12;

// The per-segment length we aim for when splitting a target duration into beats.
// This is the "秒数 / N" divisor: ~6s clips is the short-drama sweet spot and the
// count the pipeline lands on for a 50s reel (~8 beats).
export const SEGMENT_SECONDS_TARGET = 6;

// Hard ceiling so a runaway target can never fan out into an unbounded number of
// paid Ark generations. A 120s reel lands at 12 × ~10s.
export const MAX_SEGMENTS = 12;
// A reel always needs at least a hook and a payoff.
export const MIN_SEGMENTS = 2;

// Bounds the character-sheet image cost and keeps the reference_image count
// within Seedance 2.x's 9-image limit with headroom.
export const MAX_MAIN_CHARACTERS = 3;

// Vertical short-drama 投流 is short and cheap by design.
export const DEFAULT_TARGET_DURATION_S = 50;
export const MIN_TARGET_DURATION_S = 4;
export const MAX_TARGET_DURATION_S = 120;

// Seedance 2.x hard duration range (integer seconds). Every generation sends an
// integer `duration` in this range — including reference mode (the official API
// accepts duration there; only out-of-range values 400). See ADR-0018.
export const ARK_DURATION_MIN = 4;
export const ARK_DURATION_MAX = 15;

export function clampSegmentSeconds(value: number | undefined, max = SEGMENT_SECONDS_MAX): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : SEGMENT_SECONDS_TARGET;
  return Math.min(max, Math.max(SEGMENT_SECONDS_MIN, n));
}

// Clamp any requested segment length to the model's real integer duration range
// before it goes on the wire.
export function clampArkDuration(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : SEGMENT_SECONDS_TARGET;
  return Math.min(ARK_DURATION_MAX, Math.max(ARK_DURATION_MIN, n));
}

// How many beats/segments a target duration should split into. This is the
// deterministic "秒数 / 6" count the pipeline is built around: round(total / 6),
// floored at a hook+payoff pair and capped at MAX_SEGMENTS. The script planner is
// then told to write EXACTLY this many distinct beats, so beat count is derived
// from duration, never invented — and each beat maps 1:1 to one segment.
export function deriveSegmentCount(targetDurationSec: number): number {
  const raw = Math.round(targetDurationSec / SEGMENT_SECONDS_TARGET);
  return Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, raw));
}

// Even per-segment length so `count × perSegment ≈ target`, clamped to the sweet
// spot. Used both to tell the planner the budget and as the wire duration.
export function perSegmentSeconds(targetDurationSec: number, count: number): number {
  const safeCount = Math.max(1, count);
  return clampSegmentSeconds(Math.round(targetDurationSec / safeCount));
}

// A stable, non-negative 32-bit base seed for a run; each segment derives a
// DISTINCT seed from it (see deriveSegmentSeed) so segments vary while the run
// stays reproducible from the base. Seedance 2.x accepts an integer seed in
// [0, 2^31-1] (soft reproducibility: same seed+prompt → similar, not identical).
export function randomBaseSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

// Per-segment seed: distinct per segment, yet deterministic from the run's base
// seed. On 2.x seed is a soft hint, so this mainly buys run reproducibility while
// keeping each segment's noise field distinct.
export function deriveSegmentSeed(baseSeed: number, order: number): number {
  return (baseSeed + order * 2_654_435_761) % 2 ** 31;
}
