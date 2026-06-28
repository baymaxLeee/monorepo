# ADR 0011: ToolLoopAgent core with durable business context

## Status

Accepted. Supersedes ADR-0005 and the Workflow PostgreSQL clauses of ADR-0006.

## Decision

- The core chat run uses AI SDK v7 `ToolLoopAgent` and a direct UIMessage SSE
  response. The browser uses `DefaultChatTransport`.
- Run/Stop is the only execution lifecycle. Stop aborts the request and all
  model/search/tool work that accepts an AbortSignal.
- The main agent has no Workflow DevKit host, stream replay endpoint, hook
  resume endpoint, Workflow PostgreSQL, or workflow version binding.
- Continuation is a new run built from persisted UI messages, plan snapshots,
  memory and artifact state. It does not restore an in-memory execution stack.
- Client tools follow AI SDK's native pattern: no server execute function,
  `addToolOutput`, then automatic resubmission.
- Large HTML remains a bounded multipart tool protocol whose content is stored
  by knowledge. The ToolLoopAgent waits for each tool and therefore remains the
  single owner of the turn.

## Rationale

The durable host added a second stream protocol and replay cursor around an
already stateful UIMessage protocol. In practice it produced ambiguous
pause/cancel semantics, reconnect loops, and streams that stopped after only
`start` / `start-step`. Mainstream agent products treat Stop as cancellation and
continue later from durable task context, not from a replayed HTTP stream.

Workflow orchestration remains an option for genuinely autonomous background
jobs with an operational requirement to survive process loss. It is not the
default execution model for interactive chat.

## Consequences

- Process loss cancels the active request; completed messages, plans, artifact
  blocks and traces remain available for a new run.
- PostgreSQL is no longer required by the chat stack; MySQL remains the business
  source of truth.
- A future background job must introduce Workflow/queue infrastructure at that
  job boundary, not wrap the core chat agent.
