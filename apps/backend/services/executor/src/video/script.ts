// Stage A of short-drama planning: write a real SCRIPT before any storyboard.
// Splitting "write the story" from "storyboard the shots" is the single biggest
// fix for 剧情重复 (repeated plot) — a one-shot planner that does both at once
// produces shallow, interchangeable "escalation" beats. Here we force a beat
// sheet where EVERY beat carries a DISTINCT, concrete plot event plus one
// explicit visual throughline (视觉贯穿线) so the reel reads as one story, not a
// pile of similar clips (industry practice: 先剧本后分镜).
//
// Beat count is DERIVED from the target duration (秒数 / 6, see deriveSegmentCount)
// and passed in as an exact number: one beat === one segment === one continuous
// action. Two guards keep beats from collapsing back into repetition: the model
// is told to write exactly N DISTINCT beats, and a post-pass (dedupeBeats) drops
// near-duplicates and, if the model still produced a repetitive sheet, swaps in a
// deterministic DISTINCT dramatic arc built from the same characters/world.
//
// Imports `ai`, so this module is only ever reached from inside a "use step"
// body — never from the "use workflow" orchestrator (Workflow DevKit constraint,
// see executor AGENTS.md #6).
import { Output, extractJsonMiddleware, generateText, wrapLanguageModel } from "ai";
import { z } from "zod";

import { createProviderModel, JSON_OBJECT_MODE_INSTRUCTION } from "@backend/transport-ts/provider-model";
import { getProvider } from "../clients/admin.js";
import { MAX_MAIN_CHARACTERS, MAX_SEGMENTS } from "./limits.js";

export const SCRIPT_TIMEOUT_MS = 3 * 60_000;

// A recurring cast member. `id` is stable within a run and later maps to a
// character-sheet reference image (@image1..N). `appearance` stays a few dense,
// concrete tokens (hair, face marks, wardrobe, build) so it can be restated
// cheaply in every segment prompt.
export type Character = {
  id: string;
  name: string;
  appearance: string;
};

// One distinct story beat. `plot` MUST be a concrete, non-repeating event that
// moves the story forward; `emotion` is its felt turn; `characters` names who is
// on screen (for later @reference binding).
export type Beat = {
  order: number;
  purpose: string;
  plot: string;
  emotion: string;
  characters: string[];
};

export type Script = {
  logline: string;
  characters: Character[];
  // The visual throughline repeated across the reel (a recurring prop, colour,
  // or motif) — without it, independently generated clips read as unrelated.
  motif: string;
  styleBible: string;
  settingBible: string;
  beats: Beat[];
};

export function buildVideoTextModel(userId: string, providerId: string) {
  return getProvider(userId, providerId).then((provider) => ({
    model: createProviderModel(provider, { disableReasoning: true }),
  }));
}

const characterSchema = z.object({
  name: z.string().min(1).max(40),
  appearance: z.string().min(1).max(160),
});

const beatSchema = z.object({
  purpose: z.string().min(1).max(60),
  plot: z.string().min(1).max(240),
  emotion: z.string().min(1).max(60),
  characters: z.array(z.string().min(1).max(40)).max(4).optional(),
});

const scriptSchema = z.object({
  logline: z.string().min(1).max(240),
  characters: z.array(characterSchema).min(1).max(MAX_MAIN_CHARACTERS),
  motif: z.string().min(1).max(160),
  style_bible: z.string().min(1).max(240),
  setting_bible: z.string().min(1).max(240),
  beats: z.array(beatSchema).min(1).max(MAX_SEGMENTS),
});

function scriptInstructions(beatCount: number, targetDurationSec: number): string {
  return [
    "You are a senior short-drama screenwriter writing a VERTICAL (9:16) reel for 抖音/小红书 投流 (paid distribution). Output a SCRIPT, not a shot list — the storyboard comes later.",
    "Write a retention-first arc with a clear 4-part shape: a 3-second HOOK (conflict / question / striking image) → develop the character and stakes → a turn/反转 → a payoff or cliffhanger.",
    `Write EXACTLY ${beatCount} BEATS for this ~${targetDurationSec}s reel — no more, no fewer. Each beat becomes ONE ~${Math.round(targetDurationSec / beatCount)}s clip.`,
    // The core anti-repetition rule.
    `CRITICAL — the ${beatCount} beats must be ${beatCount} DIFFERENT scenes. Every beat must carry a DISTINCT, concrete plot event that MOVES THE STORY FORWARD, and must CHANGE the location, the on-screen action, OR the situation from the beat before it. No two beats may show the same moment, the same action, or the same emotional note. If you cannot make a beat genuinely new, you have too many beats — but you must still output exactly ${beatCount}, so invent a real new development instead of restating. Write \`plot\` as a specific visible event ('she finds his phone open to a message', not 'she is upset').`,
    "Think of the whole reel as a timeline that never revisits an earlier state: setup → complication → escalation → turn → payoff. Later beats build on earlier ones; they never re-show them.",
    "Externalise emotion as visible events, never inner monologue.",
    // Characters as reusable assets.
    `Define 1–${MAX_MAIN_CHARACTERS} recurring characters. For each give a fixed \`appearance\` in a few concrete tokens (hair, face, wardrobe, build) — this is reused verbatim to keep them recognizable across independently generated segments. Reuse the SAME character across beats; do not invent a new look each beat.`,
    "For each beat, list which characters appear (by name) in `characters`.",
    // The throughline.
    "`motif`: ONE recurring visual throughline for the whole reel — a specific prop, colour, or image that reappears across beats and ties them together (e.g. 'a chipped blue coffee cup'). This is what makes the clips read as one story.",
    // World + look, kept short (reused in every segment prompt downstream).
    "`setting_bible`: the shared world in specific repeatable tokens (e.g. 'cramped neon-lit noodle stall, steel counter', not just 'restaurant').",
    "`style_bible`: one visual direction — palette, colour grade, lens feel, and a concrete LIGHTING setup (lighting is the highest-impact detail — e.g. 'warm rim light, deep shadows').",
    "Keep every field tight and concrete; these anchors get restated downstream, so long prose here wastes the video model's prompt budget.",
    // MUST stay last (json_object mode 400s without the word "json").
    JSON_OBJECT_MODE_INSTRUCTION,
  ].join("\n");
}

// A DISTINCT dramatic arc: each entry is a different narrative FUNCTION, so beats
// built from it can never read as repetition even without an LLM. Long enough to
// cover MAX_SEGMENTS; we take the first N in order (hook always first, payoff
// always last via the reorder in arcBeats).
const DRAMATIC_ARC: ReadonlyArray<{ purpose: string; plot: string; emotion: string }> = [
  { purpose: "hook", plot: "Cold-open in the middle of the core conflict — the single most arresting image that poses the story's question.", emotion: "urgent, arresting" },
  { purpose: "setup", plot: "Establish who the protagonist is and the one thing they cannot afford to lose.", emotion: "grounded, wary" },
  { purpose: "inciting", plot: "A concrete event forces the protagonist to act — the point of no return.", emotion: "tense, decisive" },
  { purpose: "escalation", plot: "The first attempt backfires and a new obstacle raises the stakes.", emotion: "rising pressure" },
  { purpose: "complication", plot: "An ally or detail the protagonist trusted turns out to be a problem.", emotion: "uneasy, doubting" },
  { purpose: "turn", plot: "A reversal flips what the protagonist and the viewer believed to be true.", emotion: "shock, turn" },
  { purpose: "crisis", plot: "Everything the protagonist relied on fails; they are cornered with no easy way out.", emotion: "desperate" },
  { purpose: "climax", plot: "The protagonist makes the hardest choice and confronts the conflict head-on.", emotion: "peak intensity" },
  { purpose: "aftermath", plot: "The dust settles and the real cost of the choice becomes visible.", emotion: "raw, spent" },
  { purpose: "twist", plot: "One last hidden fact recontextualises everything that just happened.", emotion: "cold realisation" },
  { purpose: "payoff", plot: "The consequence lands — a resolution or a sharp cliffhanger that answers the hook.", emotion: "charged, unresolved" },
  { purpose: "button", plot: "A final beat that leaves the viewer wanting the next episode.", emotion: "hungry, hooked" },
];

// Build `count` DISTINCT beats from the arc, keeping the hook first and the
// payoff last. Used by the deterministic fallback and to repair a collapsed
// (repetitive) LLM beat sheet while reusing the LLM's real characters.
function arcBeats(count: number, characterNames: string[]): Beat[] {
  const n = Math.max(2, Math.min(count, DRAMATIC_ARC.length));
  const cast = characterNames.length ? characterNames : ["the protagonist"];
  const picked = n >= DRAMATIC_ARC.length
    ? [...DRAMATIC_ARC]
    : [DRAMATIC_ARC[0]!, ...DRAMATIC_ARC.slice(1, n - 1), DRAMATIC_ARC[DRAMATIC_ARC.length - 1]!];
  return picked.slice(0, n).map((a, i) => ({
    order: i,
    purpose: a.purpose,
    plot: a.plot,
    emotion: a.emotion,
    characters: cast,
  }));
}

function deterministicScript(prompt: string, count: number): Script {
  const gist = prompt.trim().slice(0, 200);
  return {
    logline: gist,
    characters: [
      {
        id: "character-1",
        name: "the protagonist",
        appearance: `Consistent protagonist as described in: ${gist}`,
      },
    ],
    motif: "a single recurring object tied to the premise",
    styleBible:
      "Cinematic vertical short-drama look: punchy colour grade, shallow depth of field, directional key light with deep shadows.",
    settingBible: `Consistent world and key locations as implied by: ${gist}`,
    beats: arcBeats(count, ["the protagonist"]),
  };
}

// Token set of a beat's plot+purpose, for near-duplicate detection.
function beatTokens(beat: Beat): Set<string> {
  const words = `${beat.purpose} ${beat.plot}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

// Drop beats that are near-duplicates of an earlier kept beat (the direct cause
// of 剧情重复). Returns the surviving distinct beats, re-ordered.
function dedupeBeats(beats: Beat[]): Beat[] {
  const kept: { beat: Beat; toks: Set<string> }[] = [];
  for (const beat of beats) {
    const toks = beatTokens(beat);
    if (kept.some((k) => jaccard(k.toks, toks) >= 0.7)) continue;
    kept.push({ beat, toks });
  }
  return kept.map((k, i) => ({ ...k.beat, order: i }));
}

export async function planScript(input: {
  prompt: string;
  targetDurationSec: number;
  // Exact number of beats to write (== number of segments == 秒数 / 6). Derived
  // by the caller via deriveSegmentCount so length control is deterministic.
  count: number;
  model: Awaited<ReturnType<typeof buildVideoTextModel>>["model"];
  abortSignal: AbortSignal;
}): Promise<Script> {
  const count = Math.max(2, Math.min(input.count, MAX_SEGMENTS));
  const fallback = deterministicScript(input.prompt, count);
  try {
    const structuredModel = wrapLanguageModel({ model: input.model, middleware: extractJsonMiddleware() });
    const result = await generateText({
      model: structuredModel,
      output: Output.object({ schema: scriptSchema }),
      instructions: scriptInstructions(count, input.targetDurationSec),
      prompt: [
        `<premise>${input.prompt}</premise>`,
        `<target_duration_seconds>${input.targetDurationSec}</target_duration_seconds>`,
        `<beat_count>${count}</beat_count>`,
      ].join("\n"),
      maxOutputTokens: 4_000,
      abortSignal: input.abortSignal,
    });
    const out = result.output;
    if (!out || !out.beats?.length || !out.characters?.length) return fallback;
    const characters: Character[] = out.characters.slice(0, MAX_MAIN_CHARACTERS).map((c, i) => ({
      id: `character-${i + 1}`,
      name: c.name.trim().slice(0, 40),
      appearance: c.appearance.trim().slice(0, 160),
    }));
    const names = new Set(characters.map((c) => c.name));
    const rawBeats: Beat[] = out.beats.slice(0, MAX_SEGMENTS).map((b, i) => ({
      order: i,
      purpose: b.purpose.trim().slice(0, 60),
      plot: b.plot.trim().slice(0, 240),
      emotion: b.emotion.trim().slice(0, 60),
      // Keep only character names the script actually declared.
      characters: (b.characters ?? []).map((n) => n.trim()).filter((n) => names.has(n)),
    }));
    // Anti-repetition guard: drop near-duplicate beats. If the model collapsed
    // the sheet into (near-)identical beats, rebuild a DISTINCT arc from the same
    // characters instead of shipping repeated plot.
    let beats = dedupeBeats(rawBeats);
    if (beats.length < Math.min(2, rawBeats.length) || beats.length < Math.ceil(count / 2)) {
      console.warn("[executor] script beats collapsed to too few distinct events, using deterministic arc", {
        asked: count,
        distinct: beats.length,
      });
      beats = arcBeats(count, characters.map((c) => c.name));
    }
    return {
      logline: out.logline.trim().slice(0, 240) || fallback.logline,
      characters,
      motif: out.motif.trim().slice(0, 160) || fallback.motif,
      styleBible: out.style_bible.trim().slice(0, 240) || fallback.styleBible,
      settingBible: out.setting_bible.trim().slice(0, 240) || fallback.settingBible,
      beats,
    };
  } catch (error) {
    if (input.abortSignal.aborted) throw error;
    console.error("[executor] script planning failed, using deterministic fallback", error);
    return fallback;
  }
}
