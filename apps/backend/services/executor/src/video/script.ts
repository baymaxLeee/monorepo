import { Output, extractJsonMiddleware, generateText, wrapLanguageModel } from "ai";
import { z } from "zod";

import { createProviderModel, JSON_OBJECT_MODE_INSTRUCTION } from "@backend/transport-ts/provider-model";
import { getProvider } from "../clients/admin.js";
import { MAX_MAIN_CHARACTERS, MAX_SEGMENTS } from "./limits.js";

export const SCRIPT_TIMEOUT_MS = 3 * 60_000;

export type Character = {
  id: string;
  name: string;
  appearance: string;
};

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
  motif: string;
  styleBible: string;
  settingBible: string;
  beats: Beat[];
};

export function buildVideoTextModel(providerId: string, orgId: string) {
  return getProvider(providerId, orgId).then((provider) => ({
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

function scriptInstructions(beatCount: number, targetDurationSec: number, aspectLabel: string): string {
  return [
    `You are a senior short-drama screenwriter writing a ${aspectLabel} reel for 抖音/小红书 投流 (paid distribution). Output a SCRIPT, not a shot list — the storyboard comes later.`,
    "Write a retention-first arc with a clear 4-part shape: a 3-second HOOK (conflict / question / striking image) → develop the character and stakes → a turn/反转 → a payoff or cliffhanger.",
    `Write EXACTLY ${beatCount} BEATS for this ~${targetDurationSec}s reel — no more, no fewer. Each beat becomes ONE ~${Math.round(targetDurationSec / beatCount)}s clip.`,
    `CRITICAL — the ${beatCount} beats must be ${beatCount} DIFFERENT scenes. Every beat must carry a DISTINCT, concrete plot event that MOVES THE STORY FORWARD, and must CHANGE the location, the on-screen action, OR the situation from the beat before it. No two beats may show the same moment, the same action, or the same emotional note. If you cannot make a beat genuinely new, you have too many beats — but you must still output exactly ${beatCount}, so invent a real new development instead of restating. Write \`plot\` as a specific visible event ('she finds his phone open to a message', not 'she is upset').`,
    "Think of the whole reel as a timeline that never revisits an earlier state: setup → complication → escalation → turn → payoff. Later beats build on earlier ones; they never re-show them.",
    "Externalise emotion as visible events, never inner monologue.",
    `Define 1–${MAX_MAIN_CHARACTERS} recurring characters. For each give a fixed \`appearance\` in a few concrete tokens (hair, face, wardrobe, build) — this is reused verbatim to keep them recognizable across independently generated segments. Reuse the SAME character across beats; do not invent a new look each beat.`,
    "For each beat, list which characters appear (by name) in `characters`.",
    "`motif`: ONE recurring visual throughline for the whole reel — a specific prop, colour, or image that reappears across beats and ties them together (e.g. 'a chipped blue coffee cup'). This is what makes the clips read as one story.",
    "`setting_bible`: the shared world in specific repeatable tokens (e.g. 'cramped neon-lit noodle stall, steel counter', not just 'restaurant').",
    "`style_bible`: one visual direction — palette, colour grade, lens feel, and a concrete LIGHTING setup (lighting is the highest-impact detail — e.g. 'warm rim light, deep shadows').",
    "Keep every field tight and concrete; these anchors get restated downstream, so long prose here wastes the video model's prompt budget.",
    JSON_OBJECT_MODE_INSTRUCTION,
  ].join("\n");
}

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

function dedupeBeats(beats: Beat[]): Beat[] {
  const kept: { beat: Beat; toks: Set<string> }[] = [];
  for (const beat of beats) {
    const toks = beatTokens(beat);
    if (kept.some((k) => jaccard(k.toks, toks) >= 0.7)) continue;
    kept.push({ beat, toks });
  }
  return kept.map((k, i) => ({ ...k.beat, order: i }));
}

const anchorsSchema = z.object({
  logline: z.string().min(1).max(240),
  motif: z.string().min(1).max(160),
  style_bible: z.string().min(1).max(240),
  setting_bible: z.string().min(1).max(240),
  characters: z.array(characterSchema).min(1).max(MAX_MAIN_CHARACTERS).optional(),
});

function mapUserCharacters(
  characters: UserVideoCharacter[],
  promptFallback: string,
): Character[] {
  return characters.slice(0, MAX_MAIN_CHARACTERS).map((character, index) => ({
    id: `character-${index + 1}`,
    name: character.name.trim().slice(0, 40),
    appearance: (character.appearance ?? promptFallback).slice(0, 160),
  }));
}

function mapExtractedCharacters(characters: z.infer<typeof characterSchema>[]): Character[] {
  return characters.slice(0, MAX_MAIN_CHARACTERS).map((character, index) => ({
    id: `character-${index + 1}`,
    name: character.name.trim().slice(0, 40),
    appearance: character.appearance.trim().slice(0, 160),
  }));
}

function defaultScriptCharacters(prompt: string): Character[] {
  return [{
    id: "character-1",
    name: "the protagonist",
    appearance: prompt.trim().slice(0, 160),
  }];
}

export type UserVideoSegment = {
  content: string;
  narration?: string;
  dialogue?: string;
};

export type UserVideoCharacter = {
  name: string;
  appearance?: string;
};

function anchorsInstructions(extractCharacters: boolean, aspectLabel: string): string {
  const lines = [
    `You are a short-drama production designer. Output global visual anchors for a ${aspectLabel} reel.`,
    "Do NOT write beats, scenes, or a shot list — those are already fixed.",
    "Keep every field tight and concrete; these anchors get restated downstream.",
  ];
  if (extractCharacters) {
    lines.push(
      `Also extract 1–${MAX_MAIN_CHARACTERS} recurring NAMED characters from the premise and segment text.`,
      "Use the story's actual names (e.g. 阿莲, 周明), never generic labels like 'the protagonist' unless no names exist.",
      "For each character give a fixed `appearance` in concrete tokens (hair, face, wardrobe, build) reused across segments.",
    );
  }
  lines.push(JSON_OBJECT_MODE_INSTRUCTION);
  return lines.join("\n");
}

function inferBeatCharacters(content: string, characters: Character[]): string[] {
  const matched = characters
    .map((character) => character.name)
    .filter((name) => content.includes(name));
  return matched.length ? matched : characters.map((character) => character.name);
}

function deterministicAnchors(prompt: string): Omit<Script, "beats" | "characters"> {
  const gist = prompt.trim().slice(0, 200);
  return {
    logline: gist,
    motif: "a single recurring visual throughline tied to the premise",
    styleBible:
      "Cinematic vertical short-drama look: punchy colour grade, shallow depth of field, directional key light with deep shadows.",
    settingBible: `Consistent world and key locations as implied by: ${gist}`,
  };
}

export async function buildScriptFromSegments(input: {
  prompt: string;
  segments: UserVideoSegment[];
  characters?: UserVideoCharacter[];
  model: Awaited<ReturnType<typeof buildVideoTextModel>>["model"];
  abortSignal: AbortSignal;
  aspectLabel?: string;
}): Promise<Script> {
  const userProvidedCharacters = Boolean(input.characters?.length);
  let scriptCharacters: Character[] = userProvidedCharacters
    ? mapUserCharacters(input.characters!, input.prompt.trim())
    : defaultScriptCharacters(input.prompt);

  let anchors = deterministicAnchors(input.prompt);
  const aspectLabel = input.aspectLabel ?? "Vertical 9:16";
  try {
    const structuredModel = wrapLanguageModel({ model: input.model, middleware: extractJsonMiddleware() });
    const segmentOutline = input.segments
      .map((segment, index) => `  ${index + 1}. ${segment.content}`)
      .join("\n");
    const result = await generateText({
      model: structuredModel,
      output: Output.object({ schema: anchorsSchema }),
      instructions: anchorsInstructions(!userProvidedCharacters, aspectLabel),
      prompt: [
        `<premise>${input.prompt}</premise>`,
        `<segments>\n${segmentOutline}\n</segments>`,
      ].join("\n"),
      maxOutputTokens: 1_600,
      abortSignal: input.abortSignal,
    });
    const out = result.output;
    if (out) {
      anchors = {
        logline: out.logline.trim().slice(0, 240) || anchors.logline,
        motif: out.motif.trim().slice(0, 160) || anchors.motif,
        styleBible: out.style_bible.trim().slice(0, 240) || anchors.styleBible,
        settingBible: out.setting_bible.trim().slice(0, 240) || anchors.settingBible,
      };
      if (!userProvidedCharacters && out.characters?.length) {
        scriptCharacters = mapExtractedCharacters(out.characters);
      }
    }
  } catch (error) {
    if (input.abortSignal.aborted) throw error;
    console.warn("[executor] scripted anchors planning failed, using deterministic fallback", error);
  }

  const beats: Beat[] = input.segments.map((segment, index) => ({
    order: index,
    purpose: `scene-${index + 1}`,
    plot: segment.content.trim(),
    emotion: "as directed",
    characters: inferBeatCharacters(segment.content, scriptCharacters),
  }));

  return {
    ...anchors,
    characters: scriptCharacters,
    beats,
  };
}

export async function planScript(input: {
  prompt: string;
  targetDurationSec: number;
  count: number;
  model: Awaited<ReturnType<typeof buildVideoTextModel>>["model"];
  abortSignal: AbortSignal;
  aspectLabel?: string;
}): Promise<Script> {
  const count = Math.max(2, Math.min(input.count, MAX_SEGMENTS));
  const fallback = deterministicScript(input.prompt, count);
  const aspectLabel = input.aspectLabel ?? "Vertical 9:16";
  try {
    const structuredModel = wrapLanguageModel({ model: input.model, middleware: extractJsonMiddleware() });
    const result = await generateText({
      model: structuredModel,
      output: Output.object({ schema: scriptSchema }),
      instructions: scriptInstructions(count, input.targetDurationSec, aspectLabel),
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
      characters: (b.characters ?? []).map((n) => n.trim()).filter((n) => names.has(n)),
    }));
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
