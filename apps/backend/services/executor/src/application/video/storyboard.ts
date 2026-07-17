import { Output, extractJsonMiddleware, generateText, wrapLanguageModel } from "ai";
import { z } from "zod";

import { generateArkImageUrl, type ArkImageRef } from "../../infrastructure/clients/ark.js";
import { getProvider } from "../../infrastructure/clients/admin.js";
import { JSON_OBJECT_MODE_INSTRUCTION } from "@backend/transport-ts/provider-model";
import { MAX_SEGMENTS, perSegmentSeconds } from "./limits.js";
import type { VideoOutputConfig } from "./output-config.js";
import { buildVideoTextModel, type Character, type Script, type UserVideoSegment } from "./script.js";

export const STORYBOARD_TIMEOUT_MS = 3 * 60_000;

export type Segment = {
  id: string;
  order: number;
  purpose: string;
  characters: string[];
  seconds: number;
  shotSize: string;
  camera: string;
  action: string;
  dialogue?: string;
  narration?: string;
  mood: string;
  faithful?: boolean;
};

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

function faithfulStoryboardInstructions(
  script: Script,
  userSegments: UserVideoSegment[],
  perSegmentSec: number,
  aspectLabel: string,
): string {
  const beatList = script.beats
    .map((beat, index) => {
      const user = userSegments[index];
      const narration = user?.narration?.trim();
      const dialogue = user?.dialogue?.trim();
      return [
        `  ${index}. FIXED ACTION: ${user?.content ?? beat.plot}`,
        narration ? `     narration/subtitle (preserve verbatim): ${narration}` : null,
        dialogue ? `     spoken line (preserve verbatim): ${dialogue}` : null,
      ].filter(Boolean).join("\n");
    })
    .join("\n");
  return [
    `You are storyboarding a pre-written ${aspectLabel} short-drama reel. The plot for each segment is FIXED — do NOT invent new events or change the story.`,
    `Produce EXACTLY ONE segment per beat, IN THE SAME ORDER (${script.beats.length} beats → ${script.beats.length} segments).`,
    `Each segment is ONE Seedance generation of ONE continuous, single-take action lasting about ${perSegmentSec}s.`,
    "For EACH segment output: `shot_size`, `camera`, `action`, optional `dialogue`, and `mood`.",
    "The `action` must stay semantically identical to the FIXED ACTION (only minor camera-friendly rewording allowed).",
    "If narration/subtitle text is provided, do NOT put it in `action` or `dialogue` — the system appends it separately.",
    "If a spoken line is provided, copy it into `dialogue` verbatim.",
    "State CAMERA move (`camera`) and SUBJECT motion (`action`) separately.",
    "Adjacent segments MUST contrast in `shot_size` and/or `camera`.",
    "",
    "FIXED SCRIPT SEGMENTS:",
    beatList,
    "",
    JSON_OBJECT_MODE_INSTRUCTION,
  ].join("\n");
}

function storyboardInstructions(script: Script, perSegmentSec: number, aspectLabel: string): string {
  const beatList = script.beats
    .map((b, i) => `  ${i}. [${b.purpose}] ${b.plot} (mood: ${b.emotion}; on screen: ${b.characters.join(", ") || "protagonist"})`)
    .join("\n");
  return [
    `You are a senior director storyboarding a ${aspectLabel} short-drama reel. You are given a finished SCRIPT; do NOT invent new plot — render the existing beats.`,
    `Produce EXACTLY ONE segment per beat, IN THE SAME ORDER as the beats (${script.beats.length} beats → ${script.beats.length} segments).`,
    `Each segment is ONE Seedance generation of ONE continuous, single-take action lasting about ${perSegmentSec}s — NOT a multi-shot sequence. One camera setup, one continuous action.`,
    "For EACH segment output: `shot_size` (extreme close-up / close-up / medium / wide / establishing); `camera` (EXACTLY ONE precise move — static, slow push-in, pull-out, pan, tilt, tracking, or orbit; prefer static, use motion sparingly; never 'cinematic movement' or 'fast'); `action` (ONE concrete continuous action that renders the beat, naming the character(s) involved); optional `dialogue` (one short spoken line); and `mood`.",
    "State the CAMERA move (in `camera`) and the SUBJECT's motion (in `action`) as two SEPARATE things — never fold a camera move into the action (official Seedance rule; folding them makes the model jitter).",
    "Because these become hard cuts, ADJACENT segments MUST contrast in `shot_size` and/or `camera` (e.g. wide → medium → close-up); never reuse the previous segment's framing. This is what makes the reel read as edited coverage rather than the same shot repeated.",
    "Each `action` is ONE slow, continuous action that visibly PROGRESSES from start to finish and FILLS the whole duration — describe it with 'slowly', 'gradually', 'continuously'. A near-static beat (a stare, a smirk) MUST carry a continuous micro-motion (slow push-in, drifting smoke, turning head) so the clip never freezes or loops.",
    "Write `action` concretely and visually ('he slams the cup, walks to the door, stops, does not look back', never 'he is angry'). Keep any `dialogue` to one short spoken line (it is voiced on screen), never narration.",
    "Do NOT write camera-shake, resolution, aspect-ratio, style, or anti-distortion phrases — the system appends those. Spend your words on the action and framing.",
    "",
    "SCRIPT BEATS (one segment each, in order):",
    beatList,
    "",
    JSON_OBJECT_MODE_INSTRUCTION,
  ].join("\n");
}

const FALLBACK_SHOTS = ["wide establishing", "medium", "close-up", "medium wide", "extreme close-up", "wide"];
const FALLBACK_CAMERAS = ["static", "slow push-in", "static", "slow pan", "slow tracking", "static"];

function faithfulAction(userSegment: UserVideoSegment | undefined, beat: Script["beats"][number]): string {
  if (userSegment?.content != null) return userSegment.content;
  return beat.plot;
}

function faithfulDialogue(userSegment: UserVideoSegment | undefined): string | undefined {
  if (userSegment?.dialogue == null) return undefined;
  return userSegment.dialogue;
}

function faithfulNarration(userSegment: UserVideoSegment | undefined): string | undefined {
  if (userSegment?.narration == null) return undefined;
  return userSegment.narration;
}

function deterministicSegment(
  beat: Script["beats"][number],
  script: Script,
  seconds: number,
  userSegment?: UserVideoSegment,
  faithful = false,
): Segment {
  return {
    id: `segment-${beat.order + 1}`,
    order: beat.order,
    purpose: beat.purpose,
    characters: beat.characters.length ? beat.characters : script.characters.map((c) => c.name),
    seconds,
    shotSize: FALLBACK_SHOTS[beat.order % FALLBACK_SHOTS.length]!,
    camera: FALLBACK_CAMERAS[beat.order % FALLBACK_CAMERAS.length]!,
    action: faithful ? faithfulAction(userSegment, beat) : beat.plot.trim().slice(0, 300),
    dialogue: faithful ? faithfulDialogue(userSegment) : undefined,
    narration: faithful ? faithfulNarration(userSegment) : undefined,
    mood: beat.emotion,
    ...(faithful ? { faithful: true } : {}),
  };
}

function deterministicSegments(
  script: Script,
  seconds: number,
  userSegments?: UserVideoSegment[],
  faithful = false,
): Segment[] {
  return script.beats.map((beat, index) =>
    deterministicSegment(beat, script, seconds, userSegments?.[index], faithful),
  );
}

export async function planSegments(input: {
  script: Script;
  targetDurationSec: number;
  model: Awaited<ReturnType<typeof buildVideoTextModel>>["model"];
  abortSignal: AbortSignal;
  faithful?: boolean;
  userSegments?: UserVideoSegment[];
  segmentSeconds?: number[];
  outputConfig?: Pick<VideoOutputConfig, "aspectLabel">;
}): Promise<Segment[]> {
  const beats = input.script.beats;
  const beatCount = Math.max(1, beats.length);
  const defaultSeconds = perSegmentSeconds(input.targetDurationSec, beatCount);
  const fallback = deterministicSegments(
    input.script,
    defaultSeconds,
    input.userSegments,
    input.faithful,
  ).map((segment, index) => ({
    ...segment,
    seconds: input.segmentSeconds?.[index] ?? segment.seconds,
  }));
  try {
    const structuredModel = wrapLanguageModel({ model: input.model, middleware: extractJsonMiddleware() });
    const aspectLabel = input.outputConfig?.aspectLabel ?? "Vertical 9:16";
    const instructions = input.faithful
      ? faithfulStoryboardInstructions(input.script, input.userSegments ?? [], defaultSeconds, aspectLabel)
      : storyboardInstructions(input.script, defaultSeconds, aspectLabel);
    const result = await generateText({
      model: structuredModel,
      output: Output.object({ schema: segmentsSchema }),
      instructions,
      prompt: [
        `<logline>${input.script.logline}</logline>`,
        `<beat_count>${beatCount}</beat_count>`,
        `<per_segment_seconds>${defaultSeconds}</per_segment_seconds>`,
      ].join("\n"),
      maxOutputTokens: 4_000,
      abortSignal: input.abortSignal,
    });
    const planned = result.output?.segments ?? [];
    if (!planned.length) return fallback;
    return beats.map((beat, i) => {
      const seg = planned[i];
      const userSegment = input.userSegments?.[i];
      if (!seg) return fallback[i]!;
      return {
        id: `segment-${i + 1}`,
        order: i,
        purpose: beat.purpose,
        characters: beat.characters.length ? beat.characters : input.script.characters.map((c) => c.name),
        seconds: input.segmentSeconds?.[i] ?? defaultSeconds,
        shotSize: seg.shot_size.trim().slice(0, 48),
        camera: seg.camera.trim().slice(0, 60),
        action: input.faithful
          ? faithfulAction(userSegment, beat)
          : seg.action.trim().slice(0, 300),
        dialogue: input.faithful
          ? faithfulDialogue(userSegment)
          : seg.dialogue?.trim() ? seg.dialogue.trim().slice(0, 120) : undefined,
        narration: input.faithful ? faithfulNarration(userSegment) : undefined,
        mood: seg.mood.trim().slice(0, 60),
        ...(input.faithful ? { faithful: true } : {}),
      };
    });
  } catch (error) {
    if (input.abortSignal.aborted) throw error;
    console.error("[executor] storyboard planning failed, using deterministic fallback", error);
    return fallback;
  }
}

export async function generateCharacterSheet(input: {
  orgId: string;
  imageProviderId: string;
  characters: Character[];
  perImageTimeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<CharacterRef[]> {
  const provider = await getProvider(input.imageProviderId, input.orgId);
  const refs: CharacterRef[] = [];
  for (const character of input.characters) {
    if (input.abortSignal?.aborted) throw input.abortSignal.reason;
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
        signal: input.abortSignal
          ? AbortSignal.any([
              input.abortSignal,
              AbortSignal.timeout(input.perImageTimeoutMs),
            ])
          : AbortSignal.timeout(input.perImageTimeoutMs),
      });
      refs.push({ id: character.id, name: character.name, appearance: character.appearance, url });
    } catch (error) {
      if (input.abortSignal?.aborted) throw error;
      console.warn("[executor] character sheet image failed, degrading that character to text-only", {
        character: character.name,
        error: String(error).slice(0, 200),
      });
    }
  }
  return refs;
}

export function buildSegmentContent(
  segment: Segment,
  script: Script,
  opts: {
    characterRefs: CharacterRef[];
    mode: "reference" | "text";
    outputConfig?: Pick<VideoOutputConfig, "aspectLabel">;
  },
): { prompt: string; images: ArkImageRef[] } {
  const appearing =
    opts.mode === "reference"
      ? opts.characterRefs.filter((r) =>
          segment.characters.length ? segment.characters.includes(r.name) : true,
        )
      : [];

  const lines: string[] = [];

  if (appearing.length) {
    lines.push(
      appearing.map((r, i) => `@image${i + 1} is ${r.name} (${r.appearance}).`).join(" "),
    );
  } else {
    const cast = (segment.characters.length ? segment.characters : script.characters.map((c) => c.name))
      .map((name) => script.characters.find((c) => c.name === name))
      .filter((c): c is Character => Boolean(c))
      .map((c) => `${c.name} (${c.appearance})`)
      .join("; ");
    if (cast) lines.push(`Characters: ${cast}.`);
  }

  lines.push(`${segment.shotSize}, ${segment.camera} — camera move only; the subject moves as described.`);
  lines.push(`Action: ${segment.action}`);
  const line = segment.faithful
    ? segment.dialogue
    : segment.dialogue?.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
  if (line != null && line !== "") lines.push(`Spoken line: "${line}"`);
  if (segment.faithful) {
    const narration = segment.narration;
    if (narration != null && narration !== "") {
      lines.push(`On-screen narration/subtitle: "${narration}"`);
    }
  }

  lines.push(`Setting: ${script.settingBible}. Recurring motif: ${script.motif}.`);
  lines.push(`Style: ${script.styleBible}. Mood: ${segment.mood}.`);
  const aspectLabel = opts.outputConfig?.aspectLabel ?? "Vertical 9:16";
  lines.push(
    "Keep the character's face, hair, and wardrobe identical to the reference; consistent lighting logic and colour grade.",
    `One continuous single-take action that keeps progressing forward and fills the whole clip — motion stays flowing, never paused, frozen, or looping. Natural, physically plausible movement; smooth stable motion; no distortion. ${aspectLabel}.`,
  );

  const images: ArkImageRef[] =
    opts.mode === "reference"
      ? appearing.map((r) => ({ url: r.url, role: "reference_image" as const }))
      : [];

  return { prompt: lines.join("\n"), images };
}
