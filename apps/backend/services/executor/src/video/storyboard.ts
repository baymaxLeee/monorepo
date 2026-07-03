// Short-drama (短剧投流) storyboard planning + per-scene prompt construction.
// The planner is a real 分镜师: it reads the premise, finds its emotional beats,
// and cuts it into a VARIABLE number of shots with VARIABLE per-shot durations,
// emitting a structured shot card (purpose / shot size / camera / action /
// dialogue / mood) per shot instead of one flat prompt. buildScenePrompt then
// assembles each card with the global consistency anchors using a STABLE
// six-component skeleton, so independently generated clips stay on-model and
// adjacent shots read as intentional cuts rather than glitches. Runs inside
// executor "use step" functions, never in the "use workflow" orchestrator (keeps
// storyboard.ts's Node-dependent `ai` import isolated in a step chunk).
import { Output, extractJsonMiddleware, generateText, wrapLanguageModel } from "ai";
import { z } from "zod";

import { getProvider } from "../clients/admin.js";
import { generateArkImageUrl } from "../clients/ark.js";
import { createProviderModel, JSON_OBJECT_MODE_INSTRUCTION } from "@backend/transport-ts/provider-model";

export const STORYBOARD_TIMEOUT_MS = 3 * 60_000;

// Per-shot clip length window. Seedance's hard range is 4–15s; the LOWER bound
// here is pinned at Seedance's minimum (4s) because the task API 400s any clip
// shorter than that — it is a hard floor, NOT a stylistic choice (do not lower
// it to squeeze in 2–3s "爆点" shots; those get rejected and the scene is
// dropped). We keep the UPPER bound at 8s (temporal-decay "镜头重复" guard — a
// single-prompt clip longer than ~8s drifts or emits looping frames; do NOT
// raise this). Rhythm variety comes from spreading shots ACROSS the 4–8s band
// (hooks at ~4s, emotional beats longer), not from going below 4s.
// clampClipSeconds enforces this floor so an out-of-range planner value can
// never reach the Ark request.
export const CLIP_SECONDS_MIN = 4;
export const CLIP_SECONDS_MAX = 8;
// Hard ceiling on shot count so a runaway target never fans out into an
// unbounded number of paid Ark calls.
export const MAX_SCENES = 24;

export type Scene = {
  id: string;
  order: number;
  // Narrative job of the shot (hook / problem / escalation / turn / payoff …).
  purpose: string;
  // Framing: extreme close-up / close-up / medium / wide / establishing …
  shotSize: string;
  // Exactly one camera behaviour: static / slow push-in / pan / tracking / orbit / tilt.
  camera: string;
  // One concrete, visual, continuous action for this shot.
  action: string;
  // Optional on-screen spoken line; quoted downstream to cue Seedance's audio.
  dialogue?: string;
  // Emotional tone of the shot.
  mood: string;
  seconds: number;
};

export type Storyboard = {
  styleBible: string;
  // Shared environment/world anchor (key locations, defining props, palette)
  // repeated across shots to prevent "environmental drift".
  settingBible: string;
  characterDNA: string;
  seed: number;
  scenes: Scene[];
};

export function clampClipSeconds(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.round(value as number) : 6;
  return Math.min(CLIP_SECONDS_MAX, Math.max(CLIP_SECONDS_MIN, n));
}

// Suggest a shot-count RANGE from the total-duration budget instead of pinning
// an exact count: the planner picks the actual number by narrative beats within
// this range. Density mirrors industry practice for vertical short-form (a cut
// every ~4–7s on average, hooks shorter). MAX_SCENES caps the top so a large
// target can't fan out unbounded.
export function suggestSceneRange(targetDurationSec: number): { min: number; max: number } {
  const min = Math.max(1, Math.round(targetDurationSec / 7));
  const max = Math.min(MAX_SCENES, Math.max(min, Math.round(targetDurationSec / 4)));
  return { min, max };
}

export function buildVideoTextModel(userId: string, providerId: string) {
  return getProvider(userId, providerId).then((provider) => ({
    model: createProviderModel(provider, { disableReasoning: true }),
  }));
}

// One shot card. `seconds` is optional: the planner is nudged to set it per
// shot, but a missing value degrades to an even split of the target budget.
const sceneSchema = z.object({
  purpose: z.string().min(1).max(60),
  shot_size: z.string().min(1).max(48),
  camera: z.string().min(1).max(60),
  action: z.string().min(1).max(320),
  dialogue: z.string().max(120).optional(),
  mood: z.string().min(1).max(60),
  seconds: z.number().int().min(CLIP_SECONDS_MIN).max(CLIP_SECONDS_MAX).optional(),
});

// Global anchors are repeated into EVERY scene prompt, so they are capped short
// on purpose: Seedance follows a ~60–100-word prompt best and degrades on long
// ones. Long bibles here would blow every clip's prompt past that budget.
const storyboardSchema = z.object({
  style_bible: z.string().min(1).max(240),
  setting_bible: z.string().min(1).max(240),
  character_dna: z.string().min(1).max(200),
  scenes: z.array(sceneSchema).min(1).max(MAX_SCENES),
});

function storyboardInstructions(range: { min: number; max: number }, targetDurationSec: number): string {
  return [
    "You are a senior director storyboarding a VERTICAL (9:16) short-drama reel for 抖音/小红书 投流 (paid distribution).",
    "Think like a real 分镜师: read the premise, find its emotional beats, and cut it into shots — do NOT slice it into uniform equal-length blocks.",
    // Narrative structure (retention-first).
    "Give the reel a retention-first arc with explicit beats: a 3-second HOOK (conflict / question / striking visual) → establish the character and stakes → escalate → a turn/反转 → end on a payoff or cliffhanger. (Equivalent structures you may use: hook→problem→transformation→result, or establishing→action→detail→hero.)",
    // Variable shot COUNT — driven by beats, not arithmetic.
    `Decide the NUMBER of shots from the beats, not by division. Aim for roughly ${range.min}–${range.max} shots for this ~${targetDurationSec}s reel, but let the story lead: merge a beat that needs room into one longer shot, split a beat that carries two actions into two.`,
    // Variable DURATION — matched to each shot's job.
    `Give each shot its OWN whole-second duration within the ${CLIP_SECONDS_MIN}–${CLIP_SECONDS_MAX}s range — never shorter than ${CLIP_SECONDS_MIN}s (the model rejects sub-${CLIP_SECONDS_MIN}s clips). Match length to the shot's job: a punchy hook / 爆点 / reaction beat uses the short end (~${CLIP_SECONDS_MIN}s); an emotional or establishing beat can run longer (up to ${CLIP_SECONDS_MAX}s, but longer clips drift more, so use the top of the range sparingly). Do NOT make every shot the same length. The durations should sum to roughly ${targetDurationSec}s.`,
    // Per-shot shot grammar.
    "For EACH shot output: `purpose` (its narrative job); `shot_size` (extreme close-up / close-up / medium / wide / establishing); `camera` (EXACTLY ONE precise move — static, slow push-in, pull-out, pan, tilt, tracking, or orbit; prefer static, use motion sparingly; NEVER vague terms like 'cinematic movement', and NEVER the word 'fast'); `action` (ONE concrete continuous action); optional `dialogue` (a short spoken line); and `mood`.",
    "Describe the CAMERA move (in `camera`) and the SUBJECT's motion (in `action`) as two SEPARATE things — never fold a camera move into the action, or the model jitters (this is the official Seedance rule).",
    // Cut craft — the real fix for bad transitions.
    "Make adjacent shots read as intentional cuts: consecutive shots MUST contrast in `shot_size` and/or `camera` (e.g. wide establishing → medium → close-up); never repeat the previous shot's framing.",
    "Place cuts at natural seams — the completion of an action, a location change, or an emotional turn — so a hard cut feels like editing, not a glitch.",
    "Each shot is ONE continuous action that visibly progresses from start to finish; never a looping, repeating, or frozen motion.",
    // Concreteness & dialogue.
    "Write `action` concretely and visually — 'he slams the cup on the table, walks to the door, stops, does not look back', never 'he is angry'. No abstract inner monologue; externalise it as visible action.",
    "Keep any `dialogue` to one short spoken line (it will be voiced on-screen), never narration.",
    // Global consistency anchors.
    "These three anchors are repeated into EVERY shot's prompt, so keep EACH to one short, dense line — long prompts make the model drift:",
    "`character_dna`: the protagonist's fixed appearance in a few concrete tokens (hair, face marks, wardrobe, build).",
    "`setting_bible`: the shared world in specific repeatable tokens (e.g. 'cramped neon-lit noodle stall, steel counter', not just 'restaurant').",
    "`style_bible`: one visual direction — palette, color grade, lens feel, and a concrete LIGHTING setup (lighting is the highest-impact detail — e.g. 'warm rim light, deep shadows').",
    "Restate the protagonist's key appearance briefly inside every shot's `action` so independently generated clips keep them recognizable.",
    "Do NOT write camera-shake, resolution, aspect-ratio, or anti-distortion phrases — the system appends those; spend your words on the story and the picture.",
    // MUST stay last: openai-compatible json_object mode 400s without the word
    // "json" in the messages (see JSON_OBJECT_MODE_INSTRUCTION).
    JSON_OBJECT_MODE_INSTRUCTION,
  ].join("\n");
}

// Rotating framings/cameras so even the deterministic fallback produces
// adjacent-shot contrast instead of identical repeated blocks.
const FALLBACK_SHOTS = ["wide establishing", "medium", "close-up", "medium", "extreme close-up", "wide"];
const FALLBACK_CAMERAS = ["static", "slow push-in", "static", "slow pan", "static", "slow tracking"];

function deterministicStoryboard(input: {
  prompt: string;
  sceneCount: number;
  clipSeconds: number;
  seed: number;
}): Storyboard {
  const scenes: Scene[] = Array.from({ length: input.sceneCount }, (_, i) => {
    const isFirst = i === 0;
    const isLast = i === input.sceneCount - 1;
    return {
      id: `scene-${i + 1}`,
      order: i,
      purpose: isFirst ? "hook" : isLast ? "payoff / cliffhanger" : "escalation",
      shotSize: FALLBACK_SHOTS[i % FALLBACK_SHOTS.length]!,
      camera: FALLBACK_CAMERAS[i % FALLBACK_CAMERAS.length]!,
      action: [
        isFirst
          ? "Open on an immediate hook in the first 3 seconds:"
          : isLast
            ? "Escalate to a final payoff or cliffhanger:"
            : "Escalate the tension from the previous beat:",
        input.prompt,
      ].join(" "),
      mood: isFirst ? "urgent, arresting" : isLast ? "charged, unresolved" : "rising tension",
      // Hook leans to the short end of the legal window; the rest use the default.
      seconds: isFirst ? CLIP_SECONDS_MIN : clampClipSeconds(input.clipSeconds),
    };
  });
  return {
    styleBible:
      "Cinematic vertical short-drama look: punchy color grade, shallow depth of field, directional key light with deep shadows.",
    settingBible: `Consistent world and key locations as implied by: ${input.prompt.slice(0, 200)}`,
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
  const range = suggestSceneRange(input.targetDurationSec);
  // A stable, non-negative 32-bit seed derived at plan time; shared by every
  // scene for reproducibility of the run.
  const seed = Math.floor(Math.random() * 2 ** 31);
  const fallbackCount = Math.max(range.min, Math.min(range.max, Math.round((range.min + range.max) / 2)));
  const fallback = deterministicStoryboard({
    prompt: input.prompt,
    sceneCount: fallbackCount,
    clipSeconds: clampClipSeconds(input.clipSeconds),
    seed,
  });
  try {
    const structuredModel = wrapLanguageModel({ model: input.model, middleware: extractJsonMiddleware() });
    const result = await generateText({
      model: structuredModel,
      output: Output.object({ schema: storyboardSchema }),
      instructions: storyboardInstructions(range, input.targetDurationSec),
      prompt: [
        `<premise>${input.prompt}</premise>`,
        `<target_duration_seconds>${input.targetDurationSec}</target_duration_seconds>`,
        `<suggested_shot_range>${range.min}-${range.max}</suggested_shot_range>`,
      ].join("\n"),
      maxOutputTokens: 4_000,
      abortSignal: input.abortSignal,
    });
    const planned = result.output?.scenes ?? [];
    if (!planned.length) return fallback;
    // Even split of the budget as the per-shot default when the planner omits a
    // shot's `seconds`, so a partial plan still respects the total length.
    const defaultPer = clampClipSeconds(Math.round(input.targetDurationSec / planned.length));
    return {
      styleBible: result.output?.style_bible?.trim() || fallback.styleBible,
      settingBible: result.output?.setting_bible?.trim() || fallback.settingBible,
      characterDNA: result.output?.character_dna?.trim() || fallback.characterDNA,
      seed,
      scenes: planned.slice(0, MAX_SCENES).map((scene, i) => ({
        id: `scene-${i + 1}`,
        order: i,
        purpose: scene.purpose.trim().slice(0, 60),
        shotSize: scene.shot_size.trim().slice(0, 48),
        camera: scene.camera.trim().slice(0, 60),
        action: scene.action.trim().slice(0, 320),
        dialogue: scene.dialogue?.trim() ? scene.dialogue.trim().slice(0, 120) : undefined,
        mood: scene.mood.trim().slice(0, 60),
        seconds: clampClipSeconds(scene.seconds ?? defaultPer),
      })),
    };
  } catch (error) {
    if (input.abortSignal.aborted) throw error;
    console.error("[executor] storyboard planning failed, using deterministic fallback", error);
    return fallback;
  }
}

// Compose the final Ark prompt for one scene following Seedance's official
// 6-step formula in a FIXED order — subject → action → environment → camera →
// style → constraints. Three things drive quality (per the Seedance/Kling
// prompt guides):
//   1. keep the skeleton order identical across shots — cross-clip drift comes
//      from reordering it, not from its content;
//   2. state the camera move and the subject's action as SEPARATE clauses —
//      merging them makes the model jitter;
//   3. always append a stability negative-constraint clause — the single
//      highest-ROI anti-distortion lever, which the planner is told NOT to write
//      so it lands here exactly once instead of bloating every field.
// A dialogue line, if present, is quoted to cue Seedance's native audio.
export function buildScenePrompt(scene: Scene, board: Storyboard): string {
  const parts = [
    `${board.characterDNA} ${scene.action}`,
    `Setting: ${board.settingBible}.`,
    `Camera: ${scene.shotSize}, ${scene.camera} — camera move only; the subject moves as described above.`,
    `Style: ${board.styleBible}. Mood: ${scene.mood}.`,
  ];
  // Optional chaining short-circuits to undefined when there is no dialogue, so
  // the whole expression is safely `string | undefined`. Strip any wrapping
  // quotes the planner added, then re-quote once — Seedance voices a line placed
  // inside double quotes.
  const line = scene.dialogue?.trim().replace(/^["“”']+|["“”']+$/g, "").trim();
  if (line) parts.push(`Spoken line: "${line}"`);
  parts.push(
    "Single continuous shot, one smooth camera move, motion flows naturally from start to finish. Vertical 9:16.",
    "Avoid: jitter, shaking, warped or bent limbs, extra or missing fingers, facial distortion, morphing, duplicated or looping frames.",
  );
  return parts.join("\n");
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
