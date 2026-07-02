// Short-drama (短剧投流) storyboard planning + per-scene prompt construction.
// Mirrors artifacts/generator.ts in shape: an LLM structured-output planner with
// a deterministic fallback, plus a best-effort image anchor. Runs inside
// executor "use step" functions, never in the "use workflow" orchestrator.
import { Output, extractJsonMiddleware, generateText, wrapLanguageModel } from "ai";
import { z } from "zod";

import { getProvider } from "../clients/admin.js";
import { generateArkImageUrl } from "../clients/ark.js";
import { createProviderModel } from "@backend/transport-ts/provider-model";

export const STORYBOARD_TIMEOUT_MS = 3 * 60_000;

// Vertical short-drama targets: fast, cheap, high-volume. A single clip is
// 4–15s (Seedance) and can itself hold a few native shots, so a ~50s reel is
// only a handful of scenes. Cap scene count so a runaway target never fans out
// into an unbounded number of paid Ark calls.
export const CLIP_SECONDS_MIN = 4;
export const CLIP_SECONDS_MAX = 15;
export const MAX_SCENES = 24;

export type Scene = { id: string; order: number; prompt: string; seconds: number };
export type Storyboard = {
  styleBible: string;
  characterDNA: string;
  seed: number;
  scenes: Scene[];
};

export function clampClipSeconds(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : 10;
  return Math.min(CLIP_SECONDS_MAX, Math.max(CLIP_SECONDS_MIN, n));
}

export function resolveSceneCount(targetDurationSec: number, clipSeconds: number): number {
  const raw = Math.ceil(targetDurationSec / clipSeconds);
  return Math.min(MAX_SCENES, Math.max(1, raw));
}

export function buildVideoTextModel(userId: string, providerId: string) {
  return getProvider(userId, providerId).then((provider) => ({
    model: createProviderModel(provider, { disableReasoning: true }),
  }));
}

const sceneSchema = z.object({
  prompt: z.string().min(1).max(1500),
  seconds: z.number().int().min(CLIP_SECONDS_MIN).max(CLIP_SECONDS_MAX).optional(),
});

const storyboardSchema = z.object({
  style_bible: z.string().min(1).max(1200),
  character_dna: z.string().min(1).max(600),
  scenes: z.array(sceneSchema).min(1).max(MAX_SCENES),
});

function storyboardInstructions(sceneCount: number, clipSeconds: number): string {
  return [
    `You are the director of a VERTICAL (9:16) short-drama reel for 抖音/小红书 投流 (paid distribution).`,
    `Break the user's premise into exactly ${sceneCount} consecutive scene clips, each ~${clipSeconds}s.`,
    "Optimize for retention: scene 1 must HOOK in the first 3 seconds (conflict, question, or striking visual); each following scene escalates; the last scene ends on a cliffhanger or payoff.",
    "Each scene `prompt` is a self-contained instruction to a text-to-video model. Write concrete cinematic detail: subject action, camera movement, framing, lighting, mood.",
    "Exploit native multi-shot: within one scene prompt you may describe 2–3 quick shots/angles (e.g. wide -> close-up -> reaction) to raise cut density.",
    "Restate the protagonist's key appearance in EVERY scene prompt so independently generated clips keep them recognizable.",
    "`character_dna`: one line locking the protagonist's fixed appearance (hair, face marks, wardrobe, build).",
    "`style_bible`: one shared visual direction for the whole reel — palette, grade, lens feel, energy. Vertical framing, punchy short-drama pacing.",
    "Do not number the scenes inside the prompt text and do not write shot lists as JSON; prose only.",
  ].join("\n");
}

function deterministicStoryboard(input: {
  prompt: string;
  sceneCount: number;
  clipSeconds: number;
  seed: number;
}): Storyboard {
  const scenes: Scene[] = Array.from({ length: input.sceneCount }, (_, i) => ({
    id: `scene-${i + 1}`,
    order: i,
    seconds: input.clipSeconds,
    prompt: [
      `Vertical 9:16 short-drama, beat ${i + 1} of ${input.sceneCount}.`,
      i === 0
        ? "Open with an immediate hook in the first 3 seconds."
        : i === input.sceneCount - 1
          ? "Escalate to a final payoff / cliffhanger."
          : "Escalate the tension from the previous beat.",
      `Premise: ${input.prompt}`,
      "Keep the same protagonist appearance and visual style throughout. Quick multi-shot cutting.",
    ].join(" "),
  }));
  return {
    styleBible: "Cohesive cinematic vertical short-drama look: punchy grade, shallow depth, fast pacing.",
    characterDNA: `Consistent protagonist as described in: ${input.prompt.slice(0, 200)}`,
    seed: input.seed,
    scenes,
  };
}

export async function planStoryboard(input: {
  prompt: string;
  targetDurationSec: number;
  clipSeconds: number;
  model: Awaited<ReturnType<typeof buildVideoTextModel>>["model"];
  abortSignal: AbortSignal;
}): Promise<Storyboard> {
  const clipSeconds = clampClipSeconds(input.clipSeconds);
  const sceneCount = resolveSceneCount(input.targetDurationSec, clipSeconds);
  // A stable, non-negative 32-bit seed derived at plan time; shared by every
  // scene for reproducibility of the run.
  const seed = Math.floor(Math.random() * 2 ** 31);
  const fallback = deterministicStoryboard({ prompt: input.prompt, sceneCount, clipSeconds, seed });
  try {
    const structuredModel = wrapLanguageModel({ model: input.model, middleware: extractJsonMiddleware() });
    const result = await generateText({
      model: structuredModel,
      output: Output.object({ schema: storyboardSchema }),
      instructions: storyboardInstructions(sceneCount, clipSeconds),
      prompt: [
        `<premise>${input.prompt}</premise>`,
        `<scene_count>${sceneCount}</scene_count>`,
        `<clip_seconds>${clipSeconds}</clip_seconds>`,
      ].join("\n"),
      maxOutputTokens: 4_000,
      abortSignal: input.abortSignal,
    });
    const planned = result.output?.scenes ?? [];
    if (!planned.length) return fallback;
    return {
      styleBible: result.output?.style_bible?.trim() || fallback.styleBible,
      characterDNA: result.output?.character_dna?.trim() || fallback.characterDNA,
      seed,
      scenes: planned.slice(0, MAX_SCENES).map((scene, i) => ({
        id: `scene-${i + 1}`,
        order: i,
        seconds: clampClipSeconds(scene.seconds ?? clipSeconds),
        prompt: scene.prompt.slice(0, 1500),
      })),
    };
  } catch (error) {
    if (input.abortSignal.aborted) throw error;
    console.error("[executor] storyboard planning failed, using deterministic fallback", error);
    return fallback;
  }
}

// Compose the final Ark prompt for one scene: the scene's own beat plus the
// shared style bible and a restated character DNA, so each independently
// generated clip stays on-model.
export function buildScenePrompt(scene: Scene, board: Storyboard): string {
  return [
    scene.prompt,
    `Protagonist (keep consistent): ${board.characterDNA}`,
    `Visual style (keep consistent): ${board.styleBible}`,
    "Vertical 9:16 framing.",
  ].join("\n");
}

// Best-effort single subject-anchor image. Returns a public HTTP(S) URL that
// Seedance can fetch as a reference_image — NOT a base64 data-URI: Seedance's
// task API hangs on inline `data:` URIs, so we go through the image provider's
// OpenAI-compatible /images/generations with response_format=url and pass the
// resulting URL straight through. Throws on failure; the caller degrades to
// text-only scene consistency. Assumes an Ark/OpenAI-compatible image provider
// (the whole video pipeline is Ark Seedance); a provider that only returns
// base64 simply yields no anchor.
export async function generateCharacterAnchor(input: {
  userId: string;
  imageProviderId: string;
  characterDNA: string;
  abortSignal: AbortSignal;
}): Promise<string> {
  const provider = await getProvider(input.userId, input.imageProviderId);
  return generateArkImageUrl({
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: provider.model,
    prompt: [
      "Character reference sheet, single subject, clean neutral background, waist-up, front-facing, even lighting.",
      input.characterDNA,
    ].join(" "),
    extraBody: provider.extraBody,
    signal: input.abortSignal,
  });
}
