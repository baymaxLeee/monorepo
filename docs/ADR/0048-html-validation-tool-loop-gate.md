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
7's `ToolLoopAgent.prepareStep` officially supports selecting the model and
active tools from prior completed history. Deterministic findings have fully
known repair inputs, so asking the provider to regenerate those calls adds cost
and drift without adding judgment.

## Decision

- Keep `validate_html` as a visible Chat-local async-generator tool. It reports
  `deterministic_validation`, then `content_review`, then a terminal result on
  the same official `tool-validate_html` UIMessage part. Executor has no
  validation route, TaskType, Workflow, or second progress stream.
- `deriveOrchestrationState(seed, steps)` replays terminal results from the
  current run. `prepareStep` injects exact native AI SDK tool calls for
  `validate_html(file_id)` and fully determined block-scoped
  `edit_file(document_id, changes)` batches. Both `doStream` and `doGenerate`
  use the same zero-token directive model; the provider never rewrites inputs.
- Independent artifacts share one ordered directive batch and execute with AI
  SDK native parallelism. Each artifact still follows validate → repair →
  revalidate serially.
- Only deterministic hard errors block. Reviewer advisories remain visible to
  the primary model but never enter automatic repair. A completed validation
  with no hard errors finishes the gate. Addressable
  block errors move the gate to the existing block-scoped `edit_file` repair
  directive; a successful edit creates a new revision and triggers validation
  again. An unaddressable document-level error ends the automated repair loop
  and must be reported.
- A stable error fingerprint uses sorted `block_id + code` pairs only. Repeating
  any previously seen fingerprint, including A→B→A oscillation, ends that item
  as `no_progress`; reviewer prose, evidence, suggestions, and source locations
  cannot perturb convergence.
- A failed or blocked validation attempt releases the gate and remains visible;
  the Agent must report that validation did not complete. The harness must not
  retry it invisibly.
- The whole ToolLoopAgent run uses the SDK's 20-step hard limit. At step 20 the
  tool set is empty so one final explanation remains. Pending artifacts become
  `incomplete_budget`: generated content is preserved and reported as existing
  but not fully verified.
- Keep the gate local to the current ToolLoop run. Do not inject validation
  state through `projectModelContext` and do not persist a second artifact state
  machine.

## Consequences

HTML generation and editing remain durable Executor workflows. Validation is a
bounded Chat read/check operation between Agent steps. Independent
deliverables can still be dispatched together; once their shared step settles,
the HTML artifact is validated before the Agent can finish or start unrelated
follow-up tools.

## References

- Installed `ai@7.0.26`:
  `apps/backend/services/chat/node_modules/ai/docs/03-agents/04-loop-control.mdx`
  (`prepareStep`, tool selection, and forced tool choice).
- ADR 0012: canonical HTML validation and Agent-led repair loop.
- ADR 0047: Executor workflow scope.
