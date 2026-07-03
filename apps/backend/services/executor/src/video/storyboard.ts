// Stage B of short-drama planning: turn the Stage-A SCRIPT into a SEGMENT list,
// where each segment is ONE Seedance generation of ONE continuous, forward-
// progressing action — the visual rendering of exactly one story beat.
//
// We deliberately do NOT subdivide a segment into multiple in-prompt shots. A
// beat is a single event; asking the model to "cover" it from several angles in
// one generation is what produced 块内剧情重复 (the same moment re-shot inside a
// clip). Cut density comes instead from MORE short segments hard-cut together at
// assembly — the native 投流 shape (Seedance renders a single take per generation;
// true cuts are made by concatenating generations). Cross-segment distinctness is
// the script's job (distinct beats); within-segment repetition is now impossible
// (there is only one action). See ADR-0018 (2026-07 revision).
//
// buildSegmentContent assembles each segment into the Ark request `content`
// array, binding character-sheet reference images as @image1..N. Consistency is:
//   character sheet (@reference) + repeated appearance tokens + the script's
//   visual motif + a fixed positive stability clause (Seedance ignores negative
//   prompts).
//
// Imports `ai`/ark, so every export here is reachable ONLY from a "use step"
// body, never the "use workflow" orchestrator (Workflow DevKit; AGENTS.md #6).
import { Output, extractJsonMiddleware, generateText, wrapLanguageModel } from "ai";
import { z } from "zod";

import { generateArkImageUrl, type ArkImageRef } from "../clients/ark.js";
import { getProvider } from "../clients/admin.js";
import { JSON_OBJECT_MODE_INSTRUCTION } from "@backend/transport-ts/provider-model";
import { MAX_SEGMENTS, perSegmentSeconds } from "./limits.js";
import { buildVideoTextModel, type Character, type Script } from "./script.js";

export const STORYBOARD_TIMEOUT_MS = 3 * 60_000;

// One Seedance generation == one continuous action == one story beat.
export type Segment = {
  id: string;
  order: number;
  purpose: string;
  // Names of the characters on screen in this segment (from its beat) — used to
  // pick which character-sheet references to attach + declare as @imageN.
  characters: string[];
  // Clip length in whole seconds (the wire `duration`).
  seconds: number;
  shotSize: string;
  camera: string;
  // ONE continuous, forward-progressing action that renders the whole beat.
  action: string;
  dialogue?: string;
  mood: string;
};

// A generated character-sheet reference image, carried as plain data across the
// step boundary. `url` is a public HTTP(S) URL (never base64 — Seedance hangs on
// data: URIs). Order in the run's list determines @image numbering per segment.
export type CharacterRef = {
  id: string;
  name: string;
  appearance: string;
  url: string;
};

const segmentSchema = z.object({
  shot_size: z.string().min(1).max(48),
  camera: z.string().min(1).max(60),
  action: z.string().min(1).max(300),
  dialogue: z.string().max(120).optional(),
  mood: z.string().min(1).max(60),
});

const segmentsSchema = z.object({
  segments: z.array(segmentSchema).min(1).max(MAX_SEGMENTS),
});

function storyboardInstructions(script: Script, perSegmentSec: number): string {
  const beatList = script.beats
    .map((b, i) => `  ${i}. [${b.purpose}] ${b.plot} (mood: ${b.emotion}; on screen: ${b.characters.join(", ") || "protagonist"})`)
    .join("\n");
  return [
    "You are a senior director storyboarding a VERTICAL (9:16) short-drama reel. You are given a finished SCRIPT; do NOT invent new plot — render the existing beats.",
    `Produce EXACTLY ONE segment per beat, IN THE SAME ORDER as the beats (${script.beats.length} beats → ${script.beats.length} segments).`,
    `Each segment is ONE Seedance generation of ONE continuous, single-take action lasting about ${perSegmentSec}s — NOT a multi-shot sequence. One camera setup, one continuous action.`,
    // Per-segment grammar.
    "For EACH segment output: `shot_size` (extreme close-up / close-up / medium / wide / establishing); `camera` (EXACTLY ONE precise move — static, slow push-in, pull-out, pan, tilt, tracking, or orbit; prefer static, use motion sparingly; never 'cinematic movement' or 'fast'); `action` (ONE concrete continuous action that renders the beat, naming the character(s) involved); optional `dialogue` (one short spoken line); and `mood`.",
    "State the CAMERA move (in `camera`) and the SUBJECT's motion (in `action`) as two SEPARATE things — never fold a camera move into the action (official Seedance rule; folding them makes the model jitter).",
    // The anti-repetition rule, now BETWEEN segments (there are no sub-shots).
    "Because these become hard cuts, ADJACENT segments MUST contrast in `shot_size` and/or `camera` (e.g. wide → medium → close-up); never reuse the previous segment's framing. This is what makes the reel read as edited coverage rather than the same shot repeated.",
    "Each `action` is ONE slow, continuous action that visibly PROGRESSES from start to finish and FILLS the whole duration — describe it with 'slowly', 'gradually', 'continuously'. A near-static beat (a stare, a smirk) MUST carry a continuous micro-motion (slow push-in, drifting smoke, turning head) so the clip never freezes or loops.",
    "Write `action` concretely and visually ('he slams the cup, walks to the door, stops, does not look back', never 'he is angry'). Keep any `dialogue` to one short spoken line (it is voiced on screen), never narration.",
    "Do NOT write camera-shake, resolution, aspect-ratio, style, or anti-distortion phrases — the system appends those. Spend your words on the action and framing.",
    "",
    "SCRIPT BEATS (one segment each, in order):",
    beatList,
    "",
    // MUST stay last (json_object mode 400s without the word "json").
    JSON_OBJECT_MODE_INSTRUCTION,
  ].join("\n");
}

// Rotating framings/cameras so even the no-LLM path gives adjacent segments
// intentional-looking contrast (never the same shot twice in a row).
const FALLBACK_SHOTS = ["wide establishing", "medium", "close-up", "medium wide", "extreme close-up", "wide"];
const FALLBACK_CAMERAS = ["static", "slow push-in", "static", "slow pan", "slow tracking", "static"];

// Deterministic fallback: one single-action segment per beat, framings rotated by
// position. Plot distinctness rides on the (already-distinct) beats.
function deterministicSegment(beat: Script["beats"][number], script: Script, seconds: number): Segment {
  return {
    id: `segment-${beat.order + 1}`,
    order: beat.order,
    purpose: beat.purpose,
    characters: beat.characters.length ? beat.characters : script.characters.map((c) => c.name),
    seconds,
    shotSize: FALLBACK_SHOTS[beat.order % FALLBACK_SHOTS.length]!,
    camera: FALLBACK_CAMERAS[beat.order % FALLBACK_CAMERAS.length]!,
    action: beat.plot,
    mood: beat.emotion,
  };
}

function deterministicSegments(script: Script, seconds: number): Segment[] {
  return script.beats.map((beat) => deterministicSegment(beat, script, seconds));
}

export async function planSegments(input: {
  script: Script;
  targetDurationSec: number;
  model: Awaited<ReturnType<typeof buildVideoTextModel>>["model"];
  abortSignal: AbortSignal;
}): Promise<Segment[]> {
  const beats = input.script.beats;
  const beatCount = Math.max(1, beats.length);
  const seconds = perSegmentSeconds(input.targetDurationSec, beatCount);
  const fallback = deterministicSegments(input.script, seconds);
  try {
    const structuredModel = wrapLanguageModel({ model: input.model, middleware: extractJsonMiddleware() });
    const result = await generateText({
      model: structuredModel,
      output: Output.object({ schema: segmentsSchema }),
      instructions: storyboardInstructions(input.script, seconds),
      prompt: [
        `<logline>${input.script.logline}</logline>`,
        `<beat_count>${beatCount}</beat_count>`,
        `<per_segment_seconds>${seconds}</per_segment_seconds>`,
      ].join("\n"),
      maxOutputTokens: 4_000,
      abortSignal: input.abortSignal,
    });
    const planned = result.output?.segments ?? [];
    if (!planned.length) return fallback;
    // Map over BEATS (not the model output) so we ALWAYS return one segment per
    // beat: a beat the model skipped is padded from the deterministic fallback
    // instead of silently dropping the back half of the story.
    return beats.map((beat, i) => {
      const seg = planned[i];
      if (!seg) return fallback[i]!;
      return {
        id: `segment-${i + 1}`,
        order: i,
        purpose: beat.purpose,
        characters: beat.characters.length ? beat.characters : input.script.characters.map((c) => c.name),
        seconds,
        shotSize: seg.shot_size.trim().slice(0, 48),
        camera: seg.camera.trim().slice(0, 60),
        action: seg.action.trim().slice(0, 300),
        dialogue: seg.dialogue?.trim() ? seg.dialogue.trim().slice(0, 120) : undefined,
        mood: seg.mood.trim().slice(0, 60),
      };
    });
  } catch (error) {
    if (input.abortSignal.aborted) throw error;
    console.error("[executor] storyboard planning failed, using deterministic fallback", error);
    return fallback;
  }
}

// Best-effort character sheet: one neutral, front-facing anchor image per main
// character. Bounded and independent — a failed character simply yields no ref
// (that character degrades to text-only consistency in prompts). All refs are
// public URLs (never base64). Order is preserved for @image numbering.
export async function generateCharacterSheet(input: {
  userId: string;
  imageProviderId: string;
  characters: Character[];
  perImageTimeoutMs: number;
}): Promise<CharacterRef[]> {
  const provider = await getProvider(input.userId, input.imageProviderId);
  const refs: CharacterRef[] = [];
  for (const character of input.characters) {
    try {
      const url = await generateArkImageUrl({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: provider.model,
        prompt: [
          "Character reference sheet, single subject, clean neutral background, waist-up, front-facing, even lighting, neutral expression.",
          character.appearance,
        ].join(" "),
        extraBody: provider.extraBody,
        signal: AbortSignal.timeout(input.perImageTimeoutMs),
      });
      refs.push({ id: character.id, name: character.name, appearance: character.appearance, url });
    } catch (error) {
      console.warn("[executor] character sheet image failed, degrading that character to text-only", {
        character: character.name,
        error: String(error).slice(0, 200),
      });
    }
  }
  return refs;
}

// Compose one segment into a Seedance request. Modes are mutually exclusive
// (Ark enforces it):
//   - "reference": attach character-sheet images as reference_image and declare
//     them @image1..N (multi-character lock). The default for parallel hard-cut.
//   - "first-frame": continue from the previous segment's last frame (chaining);
//     no reference_image allowed, so identity rides on text DNA + continuity.
//   - "text": no images (no character sheet available).
// Returns the prompt + ordered image list; the caller sets seconds/seed/return.
export function buildSegmentContent(
  segment: Segment,
  script: Script,
  opts: {
    characterRefs: CharacterRef[];
    mode: "reference" | "first-frame" | "text";
    firstFrameUrl?: string;
  },
): { prompt: string; images: ArkImageRef[] } {
  // Which character refs are actually on screen in this segment.
  const appearing =
    opts.mode === "reference"
      ? opts.characterRefs.filter((r) =>
          segment.characters.length ? segment.characters.includes(r.name) : true,
        )
      : [];

  const lines: string[] = [];

  if (appearing.length) {
    // Declare @image bindings in the SAME order as the images array below.
    lines.push(
      appearing.map((r, i) => `@image${i + 1} is ${r.name} (${r.appearance}).`).join(" "),
    );
  } else {
    // No reference images: restate character appearance as text DNA so the
    // model still has something to lock onto.
    const cast = (segment.characters.length ? segment.characters : script.characters.map((c) => c.name))
      .map((name) => script.characters.find((c) => c.name === name))
      .filter((c): c is Character => Boolean(c))
      .map((c) => `${c.name} (${c.appearance})`)
      .join("; ");
    if (cast) lines.push(`Characters: ${cast}.`);
  }

  // The single continuous action (no timecodes — one take fills the clip).
  lines.push(`${segment.shotSize}, ${segment.camera} — camera move only; the subject moves as described.`);
  lines.push(`Action: ${segment.action}`);
  const line = segment.dialogue?.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
  if (line) lines.push(`Spoken line: "${line}"`);

  // Shared anchors (kept compact — these repeat every segment, so long prose here
  // homogenizes the reel).
  lines.push(`Setting: ${script.settingBible}. Recurring motif: ${script.motif}.`);
  lines.push(`Style: ${script.styleBible}. Mood: ${segment.mood}.`);
  // Positive stability clause — Seedance ignores negative prompts, so phrase the
  // anti-distortion guard positively. The "one action that keeps progressing and
  // fills the clip" clause is the real fix for 镜头重复 (looping frames).
  lines.push(
    "Keep the character's face, hair, and wardrobe identical to the reference; consistent lighting logic and colour grade.",
    "One continuous single-take action that keeps progressing forward and fills the whole clip — motion stays flowing, never paused, frozen, or looping. Natural, physically plausible movement; smooth stable motion; no distortion. Vertical 9:16.",
  );

  const images: ArkImageRef[] =
    opts.mode === "reference"
      ? appearing.map((r) => ({ url: r.url, role: "reference_image" as const }))
      : opts.mode === "first-frame" && opts.firstFrameUrl
        ? [{ url: opts.firstFrameUrl, role: "first_frame" as const }]
        : [];

  return { prompt: lines.join("\n"), images };
}
