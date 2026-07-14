# ADR 0018: Concurrent short-drama video-generation workflow

## Status

Accepted — **current, validated in use (2026-07-03), and retained** as the
short-drama video-generation pipeline for now. The authoritative design is the
last section, **Update (2026-07c): remove the `chain` continuity option**, which
supersedes item 6 of the Seedance 2.0-native rebuild: the pipeline is now
**hard-cut only, always parallel** — there is no seamless/serial mode. The
immediately prior section, **Update (2026-07b): single-action segments +
wire-format corrections**, remains authoritative for everything else (one
segment is ONE continuous action, not a multi-shot clip; reference mode DOES
accept an integer `duration`; Seedance 2.0 DOES support `seed`). What survives
from earlier: the durable plan→generate→assemble skeleton, the two-stage
**script→storyboard** planning (the real fix for 剧情重复), character-sheet
`@reference`, per-segment seed, and the "loose consistency, hard cuts are the
投流 language" stance. Read the last two sections first; the earlier updates are
kept for history only (each is superseded, not current).

Refactors the `video-generation` task type introduced alongside
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
**positive** stability clause is always appended — Seedance ignores negative
prompts, so it reads "maintain consistent identity, natural stable motion, no
distortion" plus "one action that keeps progressing and fills the whole clip".
That last part is the real fix for 镜头重复 (repeated / looping frames): the
failure is an action-vs-duration mismatch — a momentary action stretched over a
long clip — so the planner is also instructed to match each shot's duration to
its motion (a near-static beat goes short or gains a continuous micro-motion),
rather than relying on a negative word list. Global anchors are
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

## Update (2026-07): Seedance 2.0-native rebuild

The two problems that surfaced in use were **场景高度重复** (clips look near
identical) and **关键剧情重复** (beats restate each other). Re-derived from first
principles + current practice, both were structural, and the fixes required
adopting Seedance 2.0 capabilities the original design predated. Seedance 2.0
went to full API GA on 火山方舟 in 2026-04 (same `POST /api/v3/contents/
generations/tasks` endpoint) with native multi-shot, multi-image `@reference`
(≤9 images), `return_last_frame` continuation, and an integer `duration`.

### Root causes (both were designed-in)

- **Visual repetition**: every scene shared **one seed** (`board.seed`) + **one
  anchor image** + ~70% identical prompt text (the three bibles restated
  verbatim). Independently generated clips with those three held constant
  converge to the same face/framing. Fixing the seed was meant to reduce drift,
  but applied *identically to every scene* it homogenizes them.
- **Plot repetition**: the storyboard was **one LLM call** that wrote the world
  bibles *and* every shot card at once. With no separate script/beat-sheet
  stage, the model emits generic interchangeable "escalation" beats. Industry
  practice is explicit: 先剧本，后分镜 (write the script, then storyboard it).
- **Silent duration bug**: the wire sent a `seconds` STRING while attaching a
  `reference_image`. Seedance 2.x's native format is an integer `duration`, and
  in multimodal-reference mode it **rejects/strips duration** (the model
  auto-picks). So the carefully-planned per-shot 4–8s lengths were likely never
  honoured — a momentary action stretched to a default length is exactly the
  action-vs-duration mismatch that causes 镜头重复.

### Decision

Rebuild the planner and generation as **script → multi-shot segments →
(optional) last-frame chaining → assemble**:

1. **Two-stage planning** (`src/video/script.ts` then `src/video/storyboard.ts`).
   Stage A (`planScript`) writes a real short-drama SCRIPT: logline, a reusable
   character table (fixed appearance tokens), and a beat sheet where **every
   beat must carry a distinct, concrete plot event** plus **one explicit visual
   throughline (motif)** repeated across beats. Stage B (`planSegments`)
   decomposes each beat into ONE **segment** = one Seedance generation rendered
   as a native **multi-shot** clip (timecoded shots `[00:00] … [00:05] …` in a
   single prompt), reusing the shot grammar. Two focused calls replace one
   20-line mega-prompt; the beat-distinctness + motif rules are the direct fix
   for 剧情重复.
2. **Segment = native multi-shot** (Seedance 2.x). A ~50s reel is ~4 segments of
   ~12s (each 2–4 timecoded shots), not ~10 independent 6s clips. 2.x keeps
   identity/lighting/style consistent *within* a segment and cuts cleanly
   between its shots, so fewer independent generations = far less cross-clip
   divergence. `SEGMENT_SECONDS_MAX = 15` (the 2.x per-generation ceiling).
3. **Character sheet + `@reference`** replaces the single anchor. `planStep`
   generates a best-effort neutral anchor **per main character** (≤3), passed as
   `reference_image` items and declared `@image1..N` in each segment prompt
   (supports 对手戏 / multi-character). Degrades per-character to text-only.
4. **Per-segment derived seed** (`deriveSegmentSeed(baseSeed, order)`) replaces
   the single shared seed: distinct per segment (visual variety) yet reproducible
   from the run's base. Identity now comes from the reference sheet, not seed.
5. **Wire format via a capability descriptor** (`seedanceCaps(model)` in
   `ark.ts`) — the ONLY place model-version differences live: integer `duration`,
   multi-image reference, `return_last_frame`, and "duration is stripped in
   reference mode" are all flags keyed off the model id (`seedance-2*`). Bumping
   to **Seedance 2.5** later is one match arm here, not an architecture change.
   In reference mode we omit `duration` and let the in-prompt timecodes drive
   length (the `requestedSeconds`/`actualDuration` logs verify this against the
   live endpoint).
6. **Continuity is now a tool option** (`continuity: "cut" | "chain"`, default
   `"cut"`). `cut`: every segment references the sheet, fans out in parallel,
   hard cuts — the native language of 投流, unchanged default. `chain`: seamless
   — each segment continues from the previous segment's last frame
   (`return_last_frame` → next `first_frame`), serial, slower; the first segment
   still establishes identity via the sheet. This finally makes last-frame
   chaining available (it was "out of scope" above) because 2.x's first/last
   frame is a first-class per-segment mode — still mutually exclusive with
   `reference_image` within one segment, which is why a chained segment relies on
   text DNA + continuity for identity.

Assembly (`assembler.ts`) is unchanged: it now concatenates ~4 segments instead
of ~10 clips. `duration` remains the total-reel target, but under 2.x reference
mode the exact total is model-approximated (timecode-driven), a deliberate
trade of exact length for native multi-shot quality.

### Consequences

- Two text-model calls per run (script + storyboard) instead of one; negligible
  next to minutes-scale video generation, and each stage gets focused
  instructions.
- Sources: Seedance 2.0 官方发布 (bytedance Seed), 火山方舟 视频生成 API,
  Seedance 2.0 apifox 原生格式 (`duration` int / `return_last_frame`), amux
  Seedance 2.0 docs (duration stripped in reference mode; `@imageN`),
  imagine.art guide (timecode multi-shot; video extension), and AI 短剧
  工业化 workflow guides (script→分镜→角色卡锁脸→首尾帧衔接, 视觉贯穿线).
- Still deliberately NOT built: LoRA/fine-tune character locking, reference-video
  motion driving, and per-shot conversational re-generation — all available in
  2.x but heavier than the 投流 demo needs.

## Update (2026-07b): single-action segments + wire-format corrections

Testing the multi-shot-per-segment build surfaced a regression and a code review
(Codex) plus a re-check against the **official** BytePlus/火山方舟 API reference
found two wire-format claims above were wrong. This update supersedes the
relevant parts of the previous one.

### What went wrong

- **块内剧情重复 (within-segment plot repetition).** Rendering one beat as a
  native multi-shot clip (2–4 timecoded shots in one generation) asked the model
  to *cover one event from several angles*. A single beat is a single event, so
  the shots re-showed the same moment — the exact repetition the storyboard was
  meant to remove, now *inside* each clip. This did not exist before the
  multi-shot planner; the user's report was correct.
- **`stripDurationInReferenceMode` was based on a false premise.** The prior
  update claimed 2.x "rejects/strips duration in reference mode." That behaviour
  is the **amux aggregator's** private adapter rule, NOT the native Volcengine
  API. The official reference and every native-format mirror send an explicit
  integer `duration` in EVERY mode — the docs even show reference examples with
  `duration: 11`. Stripping it made total length uncontrolled.
- **"Seedance 2.0 doesn't support seed" is false.** The native `POST /api/v3/
  contents/generations/tasks` body accepts a top-level integer `seed`
  (0–2,147,483,647; omit for random). On 2.x it is a *soft* reproducibility hint
  (same seed+prompt → similar, not identical), so per-segment derived seeds are
  kept — harmless and reproducible.
- **A fixed admin `"seconds": "5"` default + a `seconds`/`duration` passthrough**
  could pin every 2.x segment to 5s or 400 the request.

### Decision (current)

1. **ONE segment == ONE beat == ONE Seedance generation == ONE continuous,
   single-take action.** No in-prompt multi-shot decomposition, no timecodes.
   `storyboard.ts` (`planSegments`) turns each beat into a single
   `shot_size`/`camera`/`action`/`dialogue?`/`mood`; `buildSegmentContent` emits
   one action prompt. Within-segment repetition is now structurally impossible.
2. **Cut density comes from MORE short segments**, hard-cut at assembly — the
   native 投流 shape (Seedance renders a single take per generation; true cuts are
   made by concatenation, per Seedance/MindStudio guidance).
3. **Deterministic length: segment count = 秒数 / 12** (`deriveSegmentCount`), each
   segment targets ~12s and is clamped on the wire to the model's real integer
   **4–15** range (`clampArkDuration`). This is the fixed-duration segmentation
   logic the pre-storyboard pipeline used, now feeding the script stage instead
   of raw slicing.
4. **Anti-repetition stays the script's job, hardened.** `planScript` writes
   EXACTLY N distinct beats; `dedupeBeats` drops near-duplicates; if the sheet
   still collapses, a deterministic DISTINCT dramatic arc (`arcBeats`) is
   substituted using the model's real characters. The deterministic fallbacks no
   longer restate the premise verbatim (they were themselves a repetition source).
5. **Always send an integer `duration`** in the native field, in every mode;
   `stripDurationInReferenceMode` removed; `seconds`/`duration` removed from the
   admin extra_body allowlist and the admin video preset default (length is owned
   per-segment by the pipeline). `seedanceCaps` keeps only real version deltas
   (`durationField`, `multiImageReference`, `returnLastFrame`, `maxClipSeconds`).
6. **Reliability.** `createArkVideoTask` throws a classified `ArkRequestError`;
   `createSegmentStep` **rethrows** retryable faults (429/5xx/network) so Workflow
   DevKit retries the step, and degrades only non-retryable 4xx (bad params /
   moderation). Before assembly a quality bar requires the **hook** (segment 0)
   plus ≥60% of segments, else the run fails instead of shipping a plot hole.
7. **Assembler normalizes to 24fps** (Seedance's native rate), not 30 — forcing
   30 inserted duplicate frames.

This makes the previous update's "timecode-driven approximate length" trade-off
obsolete: length is now exact-by-construction (integer per-segment `duration`),
and the timecode-budget normalization problem disappears with the timecodes.

### Validation & status

Validated end-to-end on **2026-07-03**: both 块内 (within-segment) and 跨块
(cross-segment) 剧情重复 are gone, total length is controllable via `duration`,
and executor `nitro build` (incl. Workflow DevKit directive discovery) +
executor/chat/admin typecheck are green with no `schemas/` drift. **This is the
retained pipeline** — the items below are deferred, not rejected; revisit them
before scaling past the 投流 demo.

### Out of scope (next batch, noted not built)

Cancel-compensation of in-flight Ark tasks on workflow cancellation (persist
provider task ids → Ark cancel/delete), cost estimation + quality tiers in the
tool card, hybrid chain-islands with periodic re-anchoring, and per-segment
quality gates (black-frame / static-frame / loudness). Sources for this update:
official BytePlus ModelArk API reference (create task, prompt guide), 火山方舟
Seedance 2.0 apifox 原生格式 (`seed`/`duration` int), reAPI/QWave native mirrors
(reference-mode `duration` examples), MindStudio/Studiolist Seedance 2.0 prompt
guides (single-take per generation; concat for true cuts).

## Update (2026-07c): remove the `chain` continuity option (serial-timeout regression)

### What went wrong

Item 6 of the Seedance 2.0-native rebuild reintroduced last-frame chaining as an
opt-in `continuity: "cut" | "chain"` tool argument (default `cut`). It was
opt-in, but the chat model *chose* `chain` on its own for 爽感短剧 premises, and
`chain` is **inherently serial**: each segment must fully render before the next
can start (it feeds the previous segment's `return_last_frame` into the next
segment's `first_frame`). So total wall-clock ≈ **N × per-segment render time**
(~3–4 min/segment against Ark). A 60s reel is ~10 segments and an 80s reel ~12,
so a chained run needs ~40–48 min.

Chat blocks the `generate_video` tool on `waitForTaskTerminal`, which has a hard
**30-minute** cap (`MAX_TASK_WAIT_MS`); at the deadline it calls
`POST /tasks/:id/cancel` and throws. Observed in production data (conversation
`980dc486aa96` and two siblings): three `continuity: "chain"` video tasks, all
`cancelled` at **exactly ~1801s**, having completed only 7–9 of 10–12 segments.
The 60s timeout was not an Ark slowness bug — it was the serial chain path
colliding with the 30-min front-of-turn cap. This directly contradicts the
retained "hard cuts are the 投流 language, cut density comes from MORE short
segments" stance (Update 2026-07b), under which seamless chaining has no place.

### Decision (current)

Remove the `chain` path and all its plumbing entirely; the pipeline is
**hard-cut only, always parallel**:

1. **chat `generate_video`**: `continuity` removed from the tool `inputSchema`,
   the `generateVideo` signature, and the executor task payload.
2. **executor `videoGenerationInputSchema`**: `continuity` field removed.
3. **`videoGenerationWorkflow`**: the `if (continuity === "chain")` serial branch
   is deleted; every run fans out through `mapConcurrent(VIDEO_SEGMENT_CONCURRENCY)`
   with mode `reference` (falls back to `text` when no character sheet).
4. **Chaining primitives removed**: `SegmentMode` drops `"first-frame"`;
   `createSegmentStep`/`buildSegmentContent` drop `firstFrameUrl`/`returnLastFrame`;
   `SegmentResult`/`ArkVideoSnapshot` drop `lastFrameUrl`; `ark.ts` drops the
   `returnLastFrame` cap + param + `return_last_frame` body field + allowlist
   entry, and `ArkImageRole` narrows to `"reference_image"` only (no
   `first_frame`/`last_frame`).

Parallel `cut` keeps total wall-clock at roughly `ceil(N / VIDEO_SEGMENT_CONCURRENCY) ×
per-segment render`; the default concurrency is 12, matching the max segment
count, so the normal path submits every deterministic 6s segment in one fan-out
batch. The timeout disappears by construction, without touching the cap.

Frame-level seamless continuity (last-frame chaining) is once again **out of
scope**, as it was in the original `## Decision`. If it ever returns it must NOT
be a synchronous, turn-blocking tool call: revisit the async-delivery direction
(task runs in the background, completion pushed / persisted) before re-adding any
mode whose runtime scales linearly with segment count.

## Update (2026-07-10): scripted direct mode (respect user segments + narration + vision character refs)

Testing with conversation `5dd8769cb1e2` showed a structural mismatch: users who
supply an explicit scene-by-scene script were routed through the auto planner,
which **always** derived segment count from `duration / 6`, forced `planScript` to
invent distinct beats, and stripped narration/subtitle text before Seedance.

### Decision

Add a **dual-mode** pipeline selected by payload shape:

1. **Auto mode** (unchanged): `generate_video({ prompt, duration? })` only →
   `planScript` → `planSegments` → parallel segments.
2. **Scripted direct mode**: `generate_video({ prompt, duration?, segments[], characters? })`
   when the chat model passes structured scenes:
   - Segment count = `segments.length` (not `duration / 6`).
   - Beats map 1:1 from user `content`; no `dedupeBeats` / `arcBeats`.
   - A lightweight anchors-only LLM call sets `logline` / `motif` / bibles; plot is not rewritten.
   - `planSegments` runs in **faithful** mode: camera/framing only; user
     `narration` / `dialogue` are appended to the Seedance prompt as on-screen text.
   - Optional `characters[]` with `referenceDocumentId`: executor pulls the image
     from knowledge, runs a vision describe step, then reuses `generateCharacterSheet`
     (Ark public URL reference images — no new object-store presign infra).

Chat runtime instructions now tell the model to populate `segments[]` when the user
gives numbered/per-scene directions, and to attach character document ids from file
parts when reference images are present.

### Consequences

- Auto mode behaviour and ADR-0018 anti-repetition script rules are unchanged.
- Narration/subtitle on-screen text is allowed **only** in scripted direct mode;
  auto mode keeps "dialogue = spoken line only" to preserve prior tuning.
- Character IP fidelity is vision-describe → generated reference sheet, not
  pixel-perfect upload passthrough (knowledge `/source` URLs are auth-gated and
  unreachable by Seedance).

## Update (2026-07-14): Plan Mode uses 12-second generation shots

Seedance 2.0 can generate up to 15 seconds in one call. The retained default is
12 seconds per generation shot, which improves within-shot continuity while
leaving three seconds of provider headroom.

The `generate_video` manifest now projects the following constraints into Plan
Mode's generated `<execution_capabilities>` prompt:

- A narrative section may group several shots, but every generation shot maps to
  one Seedance call and targets about 12 seconds, never more than 15 seconds.
- Longer narrative sections are split into contiguous, non-overlapping shots; a
  60-second plan therefore contains at least 5 generation shots.
- Adjacent shots must advance a distinct information/action beat and vary
  framing, subject action, or on-screen content instead of padding or restaging
  the same moment.

Auto mode derives segment count from total duration divided by 12. In scripted
direct mode, an omitted per-segment and total duration defaults each scene to 12
seconds; explicit per-segment duration remains authoritative, and an explicit
total duration is distributed across unspecified scenes. Normal execution
preserves generation shots as one-to-one `segments[]` entries.
