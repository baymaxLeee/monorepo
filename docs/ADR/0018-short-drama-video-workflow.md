# ADR 0018: Concurrent short-drama video-generation workflow

## Status

Accepted. Refactors the `video-generation` task type introduced alongside
ADR 0014 (multimodal providers) and ADR 0015 (agent task executor). Reuses the
`html-artifact` plan -> concurrent-block -> compile shape.

## Context

The original `videoGenerationWorkflow` was a fixed three-step linear pipeline
(`createTaskStep` -> `waitForTaskStep` -> `persistStep`) that could only ever
emit one Ark Seedance clip (≤15s). That is a structural ceiling, not a tunable:
a single request cannot produce a multi-scene reel.

The product target is **vertical short-drama for 抖音/小红书 投流** (paid
distribution): fast, cheap, high-volume, hook-first, 9:16, native audio. It is
explicitly NOT a long-form cinema tool and does NOT need seamless single-take
continuity — fast hard cuts are the format's native language.

We researched current practice (Seedance 2.0 native multi-shot; forge-film /
Showrunner keyframe-anchoring; Vercel Workflow media pipelines at Mux/Flora).
Key facts that shaped the design:

- Seedance 2.0: 4–15s per clip, fixed 24fps, `generate_audio`, and **three
  mutually exclusive input modes** — first/last-frame, first-frame, and
  multimodal-reference. `reference_image` cannot be combined with
  `first_frame`/`last_frame`.
- Keyframe-anchored continuity (end-frame N = start-frame N+1) yields seamless
  transitions but is either serial (last-frame chaining) or requires the
  first/last-frame mode, which is incompatible with a character `reference_image`.
- Long-form is unnecessary and expensive here; a ~50s reel is a handful of clips.

## Decision

Rebuild `videoGenerationWorkflow` as a durable
**plan -> concurrent-scene -> ffmpeg-assemble** workflow mirroring
`htmlArtifactWorkflow`:

1. **`planStep`** (`src/video/storyboard.ts`) uses the run's **text** provider
   as a 分镜师: it reads the premise, finds the emotional beats, and emits a
   **narrative-driven, variable-length shot list** — global anchors
   (`style_bible`, `setting_bible`, `character_dna`) plus a beat-decided NUMBER of
   structured shot cards, each with its own `purpose` / `shot_size` / `camera` /
   `action` / optional `dialogue` / `mood` / `seconds` — with a deterministic
   fallback. It also generates a best-effort single subject-anchor still via the
   **image** provider when one is configured. The anchor is requested with `response_format=url` and kept as
   a **public URL** — never downloaded to base64: Seedance's task API hangs
   indefinitely on an inline `data:` URI `reference_image`, so scene creates must
   receive a reachable HTTP(S) URL.
2. **`createSceneStep` + `waitSceneStep`** per scene, fanned out with a bounded
   `mapConcurrent` (concurrency 5). Split into two durable steps so a mid-poll
   process loss re-polls the same Ark task id instead of billing a new
   generation. Each scene passes the shared anchor image (`reference_image`
   mode only), restates `character_dna` in its prompt, and shares one seed.
   A failed scene degrades (skipped at assembly) rather than failing the run.
3. **`assembleStep`** (`src/video/assembler.ts`) downloads the successful clip
   URLs, normalizes each to 9:16 / 720p / 30fps / H.264+AAC, concatenates
   (demuxer `-c copy`, re-encode fallback), and persists one mp4 to Knowledge.

Consistency is deliberately **loose**: shared anchor image + text DNA + shared
seed. We do NOT implement keyframe anchoring or last-frame chaining — hard cuts
are acceptable for short-drama and keeping scenes independent is what makes the
fan-out embarrassingly parallel.

Length is capped at 120s (default ~50s); the chat tool's `duration` argument now
means the total reel length. Clip URLs (not bytes) are the durable step state,
keeping the Workflow run's event log small.

### Shot decomposition: narrative-driven, variable length

The planner is a real 分镜师, not a slicer: it reads the premise, finds the
emotional beats (hook → escalate → turn → payoff), and decides BOTH the number of
shots and each shot's length from those beats. `suggestSceneRange` derives only a
*suggested* count range from the duration budget; the model picks the actual count
within it. Each shot carries its own `seconds` in the **4–8s** window (4s is
Seedance's hard minimum), so a hook/爆点 sits near ~4s while an establishing beat
runs to 8s — no more uniform `ceil(total / 6s)` blocks.

The **upper** bound stays **8s** (`CLIP_SECONDS_MAX`) because video models suffer
**temporal decay**: prompt attention is strong at frame 1 and weak at the end, so a
single-prompt clip longer than ~8s tends to *drift* or emit *near-duplicate /
looping frames* — the "镜头重复" bug (Seedance 2.0 docs; Kling/Runway/Veo failure
references). We do NOT raise it; cut density comes from more shots, never a longer
single clip. The **lower** bound stays at Seedance's **4s** minimum — the task API
400s shorter clips — so rhythm variety comes from spreading shots across the 4–8s
band, not from sub-4s shots. `buildScenePrompt` still appends a fixed "single continuous
shot, no repeated/looping/frozen motion" clause regardless of LLM output.
Seedance's native task API exposes no negative-prompt or multi-shot toggle, so all
of this lives in prompt text + the length window.

Each shot card is assembled by `buildScenePrompt` following Seedance's official
**6-step formula** in fixed order — subject (`character_dna`) → action →
environment (`setting_bible`) → camera (`shot_size` + `camera`) → style
(`style_bible`) + mood → constraints — with an optional quoted `dialogue` line to
cue native audio. Three quality levers from the Seedance/Kling prompt guides are
baked in: (1) the skeleton order stays identical across shots (drift comes from
reordering, not content); (2) the camera move and the subject's action are stated
as **separate** clauses — merging them makes the model jitter; (3) a fixed
**stability negative-constraint** clause (avoid jitter / warped limbs / extra
fingers / facial distortion / looping frames) is always appended — the
highest-ROI anti-distortion lever — and the planner is told NOT to write it, so
it lands exactly once instead of bloating every field. Global anchors are
length-capped (≈200–240 chars) to keep each clip's prompt near the ~60–100-word
sweet spot; over-long prompts measurably degrade Seedance's instruction-following.

**Why not use the anchor as a `first_frame` (image-to-video)?** I2V is more stable
per clip, but feeding the *same* anchor image as every scene's first frame would
make every clip open on an identical frame — manufacturing exactly the cross-scene
repetition we are fixing. We therefore keep the anchor in `reference_image` mode
(loose subject consistency) and never as `first_frame`.

## Consequences

- New OS dependency: **ffmpeg** in the executor image (`apt-get`, not
  `ffmpeg-static`, to avoid Nitro/nft native-binary bundling issues), configured
  via `FFMPEG_PATH`. Local dev needs it on PATH.
- The chat `generate_video` tool now threads three providers (video + text +
  optional image) through `catalog.ts`; text is required (Seedance cannot plan).
- Workflow DevKit constraint reaffirmed: the `"use workflow"` orchestrator (and
  any non-step helper it calls) must not transitively import Node-dependent
  modules. Scene-prompt composition lives inside `createSceneStep`, not the
  orchestrator, so `storyboard.ts`'s `ai` import stays isolated in a step chunk.
- Trade-off softened, not removed: scene cuts are still hard cuts, but the
  narrative-driven storyboard places them at natural seams (action completion,
  location change, emotional turn) and forces adjacent shots to contrast in
  `shot_size`/`camera`, so a cut reads as intentional editing rather than a
  glitch. True frame-level seamless continuity remains a separate mode (keyframe
  anchoring / last-frame chaining), mutually exclusive with the current character
  `reference_image` approach and deliberately not built.

## Update (2026-07): from uniform slicing to smart storyboard

The original planner sliced the reel into `ceil(total / 6s)` equal blocks with one
flat prompt per scene. That mechanical cut was the real source of "过渡衔接差": it
cut mid-action at arbitrary time boundaries, so neighbouring clips jumped without
the shot-language contrast that makes a cut legible. Re-derived from current
practice (Seedance official storyboard workflow; SurePrompts / Hailuo 2026
shot-list guides; AI 短剧工业化流程), the fix is to make the planner *decide* the
shots: variable count by beats, variable per-shot duration, and structured shot
grammar (shot size / camera / action / dialogue / mood) with enforced
adjacent-shot contrast, so hard cuts fall on story seams. Scenes still generate
concurrently and assemble with hard cuts — the parallel-speed baseline and the
"loose consistency" stance are unchanged; long blocks and last-frame chaining
remain out of scope.
