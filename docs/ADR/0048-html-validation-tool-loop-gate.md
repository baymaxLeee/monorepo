# ADR 0048: HTML validation is a mandatory ToolLoop gate

## Status

Accepted. Supersedes the HTML-validation removal in ADR 0047. Executor remains
generation-only and registers only the `html-artifact` and `video-generation`
workflows. Validation is a local Chat tool operation.

## Context

ADR 0047 correctly removed validation from the durable Workflow registry, but
also deleted the `html_validate` tool and its synchronous implementation. That
made it impossible for the primary Agent to verify a newly generated or edited
HTML artifact before reporting completion.

Prompt-only sequencing is insufficient for a mandatory quality gate. AI SDK
7's `ToolLoopAgent.prepareStep` officially supports choosing the active tools
and forcing a specific tool from prior step history. This is the same thin
harness boundary used by coding agents for required post-write checks: the
Agent remains responsible for interpreting findings and choosing repairs, while
the harness guarantees that the check runs.

## Decision

- Add `validate_html` as a visible, synchronous Chat tool. It reads the current
  artifact revision from Knowledge and runs validation inside Chat. Executor has
  no validation route, TaskType, or Workflow.
- After a successful HTML `write_file` or `edit_file`, `prepareStep` scans this
  run's completed tool steps. Until a later `validate_html` attempt covers that
  document revision, only `validate_html` is active and its tool choice is
  required.
- A completed validation with no hard errors finishes the gate. Addressable
  block errors move the gate to the existing block-scoped `edit_file` repair
  directive; a successful edit creates a new revision and triggers validation
  again. An unaddressable document-level error ends the automated repair loop
  and must be reported.
- A failed or blocked validation attempt releases the gate and remains visible;
  the Agent must report that validation did not complete. The harness must not
  retry it invisibly.
- Keep the gate local to the current ToolLoop run. Do not inject validation
  state through `projectModelContext` and do not persist a second artifact state
  machine.

## Consequences

HTML generation and editing remain durable Executor workflows. Validation is a
bounded synchronous Chat read/check operation between Agent steps. Independent
deliverables can still be dispatched together; once their shared step settles,
the HTML artifact is validated before the Agent can finish or start unrelated
follow-up tools.

## References

- Installed `ai@7.0.26`:
  `apps/backend/services/chat/node_modules/ai/docs/03-agents/04-loop-control.mdx`
  (`prepareStep`, tool selection, and forced tool choice).
- ADR 0012: canonical HTML validation and Agent-led repair loop.
- ADR 0047: Executor workflow scope.
