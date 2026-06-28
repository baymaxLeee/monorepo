# ADR 0007: Chat perceived latency and approved long-term memory

## Status

Accepted.

## Decision

- Treat AI SDK `submitted` as a first-class UI state and render immediate,
  accessible progress until the first streamed message part arrives.
- Load independent request context and persist request metadata concurrently;
  log server setup time separately from provider time-to-first-token.
- Keep long-term memory in chat-owned `user_memories`, outside semantic
  messages and orchestration/runtime state.
- Background extraction and `propose_memory` may create idempotent pending
  candidates, but only an authenticated user action in the memory panel may
  activate one. Candidate creation never blocks the chat stream.
- Do not use AI SDK `needsApproval` for asynchronous memory review. That API
  intentionally pauses the current agent before tool execution; reserve it for
  in-conversation actions that must not execute before an immediate decision.
- Store only stable preferences, profile facts, project facts, and standing
  instructions. Exclude one-off details, guesses, credentials, and sensitive
  data unless the user explicitly asks. Exact active duplicates are reused.

## Rationale

Model time-to-first-token cannot always be reduced by application code, but a
blank interval makes the same latency feel like a failed request. AI SDK's
`submitted` and `streaming` states provide the intended boundary for honest
feedback without emitting synthetic assistant text.

Long-term memory changes future model behavior. Treating a model proposal as
authorization silently accumulates incorrect or invasive facts. Pending
candidates preserve explicit user control without keeping an agent run open.
The review API is authenticated, approval is transactional, and extraction is
grounded only in the latest user-authored turn. This separates AI SDK's
blocking tool-approval protocol from asynchronous domain approval instead of
forcing incompatible interaction semantics into one mechanism.
