# ADR 0036: `/` skill activation persists as a message part

## Status

Accepted. Refines ADR-0033 §4 (deterministic `/` activation). Does not change
the injection semantics — only the channel the activation travels on.

## Context

ADR-0033 §4 shipped `/` skill activation: the composer sends a `skill_name`
field on the run request and the backend injects that skill's full body as a
trusted `<activated_skill>` block for the turn.

That field was a **side-band request parameter**, not part of the message. Three
problems followed, all visible against the AI SDK UIMessage protocol
(`schemas/streaming/chat-uimessage-stream.md`):

1. **No persistence.** `skill_name` never entered `message.parts`, so it was
   never written to `messages.content`. On reload, `messageToUiMessage` (which
   only restores `parts`) lost every trace of which skill drove a turn.
2. **Continuation dropped it.** The composer cleared `activatedSkillName` right
   after send, so a client-tool continuation of the *same* run re-sent an empty
   `skill_name` — the skill context evaporated mid-task.
3. **Invisible in the transcript.** Only the pre-send composer badge showed the
   skill; the sent user bubble had nothing.

This is exactly the pattern the streaming contract warns against (see the
file-token precedent): app-specific data that belongs on the message was routed
around the protocol instead of through it. The repo already has the correct
shape for this — `data-plan-execution`, a **persisted, client→server** `data-*`
part ("one channel, two roles": loaded for this run *and* kept in history).

## Decision

1. **Activation rides the message as `data-skill-activation`.** When the user
   sends with a `/` skill active, the composer appends
   `{ type: "data-skill-activation", data: { name } }` to the user message
   parts. The `skill_name` request field is removed (no historical baggage,
   mirroring the earlier removal of `document_ids`).
2. **Only the name travels, never the L2 body.** Storage stays the source of
   truth (ADR-0033 §2); the backend resolves the body from
   `/internal/skills/{id}` as before.
3. **Backend derives activation from `latestUser.parts`.**
   `activatedSkillNameFromParts` reads it off the triggering user message, then
   the existing `<activated_skill>` injection runs unchanged. Because the run
   keys on the *latest user message*, this also fixes continuation: the part is
   still on that message, so the skill stays active across the tool loop.
4. **Older turns do not re-inject.** The projector's `convertDataPart` returns
   `undefined` for `data-skill-activation`, so history copies of the part are
   dropped from model context (the SDK filters null conversions). The full body
   is injected exactly once — for the turn whose message carries the part —
   preserving ADR-0033 §4 semantics.
5. **The transcript shows the skill.** `ChatMessageView` renders a compact
   skill badge for the part, so history makes the invocation legible.

## Consequences

- Reload and client-tool continuation keep the skill; the transcript records
  which skill drove each turn — an auditability/UX gain at zero model-context
  cost (old parts are dropped, not re-injected).
- The activation now flows through the official message-parts channel like every
  other durable signal; the side-band `skill_name` field is gone.
- Registered in `schemas/streaming/chat-uimessage-stream.md` §3 alongside
  `data-plan-execution`.
- No migration: `messages.content` is schemaless `jsonb`; the new part is
  additive and `validateUIMessages` (called without `dataSchemas`) accepts it.

## References

- ADR-0033: admin-managed skills, end-to-end (`/` activation semantics)
- `schemas/streaming/chat-uimessage-stream.md`: reuse-first `data-*` contract
- Producer/consumer: `apps/frontend/apps/chat/src/pages/Chat.tsx`,
  `.../components/ChatMessageView.tsx`,
  `apps/backend/services/chat/src/application/agent/context/file-parts.ts`,
  `.../agent/runs/run.ts`, `.../routes/agents.ts`
