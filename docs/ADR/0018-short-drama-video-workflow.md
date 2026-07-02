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
   to plan a hook-first vertical shot list (`style_bible`, `character_dna`, N
   scene prompts), with a deterministic fallback. It also generates a
   best-effort single subject-anchor still via the **image** provider when one
   is configured. The anchor is requested with `response_format=url` and kept as
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
- Trade-off accepted: visible discontinuity at scene cuts. If a future product
  needs seamless continuity, that is a separate mode (keyframe anchoring),
  mutually exclusive with the current character `reference_image` approach.
