# ADR 0007: Chat perceived latency and approved long-term memory

## Status

Accepted.

## Decision

- Treat AI SDK `submitted` as a first-class UI state and render immediate,
  accessible progress until the first streamed message part arrives.
- Load independent request context and persist request metadata concurrently;
  log server setup time separately from provider time-to-first-token.
- Keep long-term memory in chat-owned `user_memories`, outside semantic
  messages and Workflow infrastructure state.
- A model may propose memory through `remember`, but persistence occurs only
  after an explicit user approval resumed through the durable Workflow hook.
- Store only stable preferences, profile facts, project facts, and standing
  instructions. Exclude one-off details, guesses, credentials, and sensitive
  data unless the user explicitly asks. Exact active duplicates are reused.

## Rationale

Model time-to-first-token cannot always be reduced by application code, but a
blank interval makes the same latency feel like a failed request. AI SDK's
`submitted` and `streaming` states provide the intended boundary for honest
feedback without emitting synthetic assistant text.

Long-term memory changes future model behavior. Treating a model proposal as
authorization silently accumulates incorrect or invasive facts. A durable
approval gate gives the user control, survives disconnects, and leaves the
tool call and decision visible in the normal agent trace.
