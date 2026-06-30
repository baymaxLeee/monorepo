# ADR 0013: Resumable transport for ToolLoopAgent streams

## Status

Accepted. Amends the Run/Stop and replay clauses of ADR-0011.

## Context

ToolLoopAgent owns an in-process model/tool loop but does not persist its
execution stack. That does not require the HTTP subscriber to own the run.
Tying the model AbortSignal to the POST request made refresh, network loss and
conversation navigation cancel otherwise healthy generations.

AI SDK's supported resume pattern keeps its native UIMessage SSE protocol,
tees the encoded stream through `consumeSseStream`, stores an active stream ID,
and reconnects `useChat` through a GET endpoint. Its abort guidance also warns
that request abort and resumable streams conflict when they share one signal:
https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-resume-streams and
https://ai-sdk.dev/docs/troubleshooting/abort-breaks-resumable-streams.

The official [`resumable-stream`](https://www.npmjs.com/package/resumable-stream)
package optimizes the common live path with a producer-side buffer and Redis
pub/sub. This service instead retains the prior Redis Stream storage shape
because the product requirement is to persist every outgoing chunk in Redis
and allow any chat replica to serve the replay directly.

The repository had this transport shape before commit
`2d2a4409b7d1dafc54f4f844819c433da49f3f5b`, where the Redis replay service was
removed as part of the Workflow Agent migration. Removing Workflow later also
removed the only remaining reconnect path.

## Decision

- Keep AI SDK v7 `ToolLoopAgent` as the single agent loop.
- Tee the encoded native UIMessage SSE into a per-run Redis Stream. Redis stores
  the active run ID per conversation and expires orphaned data after one hour.
- `POST /conversations/{id}/agents/run/stream` starts a run. The matching GET
  replays the active stream from its beginning or returns 204.
- A browser disconnect cancels only that subscriber. The server-owned run
  controller is aborted only by the authenticated run cancellation endpoint.
- `useChat` reconnects once after the selected conversation's persisted
  messages load. POST and GET expose `x-agent-run-id` so Stop still targets the
  correct run after a refresh.
- Redis blocking reads use a duplicated connection; writes remain on the main
  connection and are awaited in stream order.

## Consequences

- Refresh, temporary disconnect and switching away/back can recover an active
  response without duplicating the ToolLoopAgent run.
- Explicit Stop remains real cancellation across model and tool work.
- This is transport replay, not durable execution. Chat process loss can still
  interrupt ToolLoopAgent; completed messages, plans and artifact blocks remain
  the recovery boundary described by ADR-0011.
- Redis failure degrades a newly started run to a live-only stream rather than
  failing generation. The GET resume endpoint requires Redis availability.
