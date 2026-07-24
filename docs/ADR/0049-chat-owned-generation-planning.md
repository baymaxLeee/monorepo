# ADR-0049: Chat owns generation planning

## Status

Accepted for Chat-owned planning; its HTML-specific workflow shape is
superseded by ADR 0055.

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
  new HTML and video generation. A tool call contains the complete semantic
  plan; Executor validates the same flat payload and deterministically
  materializes its internal execution plan without another model call.
- `write_html` exposes a flat model-facing input: `title` and one authoritative
  `brief` are required; filename, mode, visual hints, and simple ordered
  `sections` are optional. Omitting `sections` deterministically creates one
  single-page block. The same compact shape crosses the service boundary. This
  keeps the trust boundary strict without making the model or Chat reproduce
  nested transport structure or redundant content-scope and acceptance arrays.
- The Chat-to-Executor `html-artifact` task payload is flat as well. `brief`,
  optional simple `sections`, `mode`, and visual fields live directly beside
  trusted actor and artifact fields; there is no `plan`, nested `theme`,
  `narrative`, or transport-level block contract. Executor deterministically
  turns omitted sections into one block and simple sections into ordered block
  contracts before Workflow execution. Revision-only fields remain top-level
  and mutually exclusive with creation fields. This is a direct contract
  replacement with no legacy wrapper or compatibility branch.
- Markdown and HTML creation use separate `write_markdown` and `write_html`
  tools. This keeps each model-visible schema shallow and preserves one semantic
  tool per deliverable rather than placing unrelated formats inside a large
  Markdown/HTML `anyOf`.
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
  `inputSchema` expresses semantic requirements and real operational boundaries,
  not arbitrary presentation heuristics such as a maximum number of content-scope
  or acceptance-criteria entries. A plan that violates the contract is bounced
  back to the same `ToolLoopAgent` as a native invalid-input tool error (execute
  never runs), and the model issues a corrected function call from the original
  context — consistent with this repo's tool-outcome convention (ADR-0042,
  "invalid input retains native control flow"). Runtime checks that a schema
  cannot express (attachment ownership,
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
