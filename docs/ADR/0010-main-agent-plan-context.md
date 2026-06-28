# ADR 0010: Main-agent plans and resumable conversation context

## Status

Accepted. Supersedes ADR 0009's dedicated artifact child workflow.

## Decision

- Chat runs one durable `WorkflowAgent`. Domain tools may be durable steps, but
  they do not start nested agent or artifact workflows.
- Complex work is represented by `update_plan`. Its normalized tool output is
  the persisted plan snapshot; stable item IDs and revisions preserve completed
  work across runs.
- Before each run, chat extracts the latest active plan from persisted
  `UIMessage` parts and injects a compact `<active_plan>` into model context.
- HTML is a normal plan: the main model calls `begin_artifact`, writes bounded
  fragments with `write_artifact_part`, and calls `publish_artifact`. These
  tools perform storage and deterministic compilation only.
- Completed artifact writes are pruned from later model steps and HTML inputs
  are redacted from conversation and trace persistence. Knowledge remains the
  source of truth for artifact content.

## Rationale

Mainstream coding agents expose plans as durable structured task state, not as
hidden progress inside a domain workflow. AI SDK tool parts already cross the
model, stream, and persistence boundaries, while `WorkflowAgent` supplies retry
and resume semantics. A second workflow duplicated those guarantees, forced
polling, and hid task state from the main agent.

## Consequences

- Refresh, cancellation, context pruning, and later turns preserve plan state.
- Large HTML is split across tool calls without repeatedly carrying completed
  fragments in model context.
- Artifact workflow binding fields, APIs, polling, and side streams are removed.
