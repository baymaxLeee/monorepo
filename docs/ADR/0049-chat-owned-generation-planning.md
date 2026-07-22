# ADR-0049: Chat owns generation planning

## Status

Accepted

## Context

Chat's `ToolLoopAgent` has the complete conversation, attachments, memories,
skills and primary reasoning model. HTML and video tasks nevertheless passed a
lossy brief to Executor, where a second model planned outlines, scripts,
storyboards and character appearance. This added a model round-trip to the
critical path and made the less-informed service responsible for interpreting
the request.

Workflow DevKit requires deterministic workflow orchestration, while retryable
steps remain appropriate for bounded external work. A durable executor should
not become a second agent loop.

## Decision

- Chat's native AI SDK tool inputs are the only semantic planning boundary for
  new HTML and video generation. A tool call contains the complete typed
  execution plan before a task is accepted.
- Markdown and HTML creation use separate `write_markdown` and `write_html`
  tools. This keeps HTML's nested plan as one object-only JSON Schema instead of
  placing it inside a Markdown/HTML `anyOf`, while preserving one semantic tool
  per deliverable rather than one tool per file extension.
  ADR 0050 further makes `write_markdown` a direct complete-content persistence
  tool shared by ordinary Markdown and Plan mode, without a nested LLM.
- Executor validates and materializes that plan, then performs durable
  generation, compilation, approvals, cost control, QA and publishing. It does
  not run outline, script, storyboard, character-vision, planner repair or
  semantic fallback calls.
- Executor may retain model calls that produce a bounded output from a frozen
  specification: HTML block rendering, character reference-image generation
  and video-media generation. These calls cannot alter plan structure.
- The task API publishes a discriminated OpenAPI contract for the two task
  types. Provider, actor, cost, ID, ordering and idempotency fields are injected
  by trusted services, never supplied by the model.
- Invalid plans are rejected before a task row or Workflow run exists, using the
  AI SDK's native tool-input contract rather than a bespoke error code. The tool
  `inputSchema` (Zod `discriminatedUnion` + `superRefine`) expresses every static
  constraint; a plan that violates it is bounced back to the same `ToolLoopAgent`
  as a native invalid-input tool error (execute never runs), and the model issues
  a corrected function call from the original context — consistent with this
  repo's tool-outcome convention (ADR-0042, "invalid input retains native control
  flow"). Runtime checks that a schema cannot express (attachment ownership,
  reference-document MIME/conversation scope) run inside execute and surface as a
  `toolFailed` outcome. Executor re-validates the same discriminated schema at its
  HTTP boundary as a cross-service trust boundary and never performs semantic
  auto-repair.
- This directly replaces the old task input and planner paths. New deployments
  accept only the new contract; Workflow deployment pinning lets already-running
  runs complete on their original code.

## Consequences

- HTML removes one Executor planning model call per task. Video removes script,
  storyboard and reference-image understanding planner calls.
- The initial production projection is immediately inspectable because Chat's
  complete plan is materialized before storyboard approval.
- Chat remains the sole agent loop and Executor remains the durable execution
  harness. No planner sub-agent, custom agent loop, compatibility adapter or
  extra stream protocol is added.
- Trace metadata records plan version and origin tool call for audit without
  storing the unprojected conversation in Executor.

## References

- [AI SDK ToolLoopAgent](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
- [AI SDK tool calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)
- [Workflow functions and steps](https://useworkflow.dev/docs/foundations/workflows-and-steps)
- [Workflow versioning](https://useworkflow.dev/docs/foundations/versioning)
- [Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
