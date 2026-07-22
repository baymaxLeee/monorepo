# ADR-0046: Durable video-production governance

## Status

Accepted

## Context

ADR-0018 established a durable script-to-storyboard-to-parallel-Seedance-to-FFmpeg pipeline. It intentionally protects Ark task creation from automatic retry, but the pipeline immediately crosses paid side effects and publishes the assembled media without a durable creative approval, cost ceiling, take review, or final delivery gate.

AI SDK tool approval and the repository's `ask_user` client tool pause a ToolLoopAgent invocation and require a later model continuation. Video approvals must instead survive closed browsers, ended SSE streams, process restarts, and long human delays without asking the model to reconstruct execution state.

## Decision

- Keep one chat `ToolLoopAgent`. Executor remains the only owner of durable video execution; no second agent loop or HarnessAgent is introduced.
- Add a `video_production` projection keyed by the executor task id. Typed, versioned production artifacts and an append-only event/decision log are the source for the director UI.
- `create_video_production` is the command to create a video production task, not a synchronous final-video generator. After initial storyboard and cost planning, the Workflow registers and awaits a deterministic Workflow Hook. The tool returns an ordinary completed outcome carrying `production_id` once that production projection is durable, so the ToolLoopAgent can finish its response and the SSE can close normally. Chat detects this from persistent post-planning projection state rather than the transient `awaiting_approval` status, which may be skipped between polls when approval is fast. UI and Todo completion use `production_id`; the eventual video document is a later Workflow result.
- Storyboard review is versioned: a structured edit persists a new immutable `shot_plan` artifact, advances the production projection, and invalidates approval of every older version.
- Approvals are explicit authenticated UI mutations proxied by Chat to Executor. They resume Workflow Hooks directly and never create an implicit model continuation.
- Approval decisions use a persisted 60-second delivery lease. Fresh pending decisions are never delivered twice; expired leases replay the original persisted action, and a boot-time plus periodic reaper recovers abandoned deliveries. Hook payloads carry the action id so reusable storyboard and Take-review hooks discard replayed events before any paid work.
- A deterministic compiler turns an approved `ShotSpec` into each Seedance request. One shot remains one beat, one paid task, and one continuous action.
- Each paid create reserves against a production-local budget before the external call. Ark create retains `maxRetries = 0`; local retries are new, explicitly approved Takes.
- Every generated shot is staged as a previewable Take. A dedicated shot-review Hook lets the user request a new paid Take for one shot, select exactly one successful Take per shot, and only then continue to assembly.
- Deterministic QA blocks corrupt or incomplete media. Evidence-backed semantic QA may be waived only by the creator or a caller with `video_production.approve`; authorization failures are never waivable.
- A semantic QA result that still requires human review can only be waived by an explicit publish approval carrying a non-empty reason. The actor and reason are persisted in the projection and decision event.
- Assembly writes a previewable staged media object. A third Workflow Hook gates promotion to a normal Knowledge document. External-channel publication is out of scope.
- The Chat MFE projects production state into its existing right-hand workspace. It does not persist a competing client state machine and does not add a custom UIMessage `data-*` part.

## Consequences

- The former foreground video-generation polling contract is replaced by the detached `create_video_production` contract. The official tool part persists task/production identity; live state comes from the authenticated production read API.
- Executor gains video-specific persistence while the generic task table and routes remain type-agnostic.
- Admin owns provider pricing configuration. Knowledge owns staged and published media bytes. Chat owns browser authorization and conversation scoping.
- Existing videos remain normal Knowledge documents. There is no compatibility branch for new productions; new video runs use the governance state machine directly.
- Approval action ids are content-addressed idempotency keys: reusing one for a different payload is a conflict, and only one pending decision may own an approval gate. Deterministic QA rejects decode/duration/dimension/audio failures plus full-black and frozen-frame intervals.
- Storyboard revisions are persisted by a Workflow step after the durable Hook event is received; the HTTP decision handler never mutates the production projection before delivery.
- Take previews remain conversation-scoped staged media and are discarded after completion, rejection, failure, or cancellation; only the approved assembled output is promoted to a Knowledge document.

## Related decisions

- [ADR-0018](./0018-short-drama-video-workflow.md)
- [ADR-0039](./0039-ai-native-target-architecture.md)
- [ADR-0042](./0042-agent-tool-outcomes.md)
