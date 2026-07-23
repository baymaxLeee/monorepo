# ADR 0012: High-level file tools and block-revision HTML artifacts

## Status

Superseded in part by ADR 0023, ADR 0047, ADR 0048, and ADR 0049. The artifact generation
pipeline remains accepted. ADR 0048 restores validation as Chat-local
`validate_html`; the Executor endpoint and `html_validate` name remain removed.

## Decision

- The ToolLoopAgent exposes a compact, flat public tool set grouped internally
  by capability. See ADR 0023 for the complete current list.
- `write_html` is the only HTML creation entry point; Markdown creation uses
  the separate `write_markdown` tool. `write_html` receives the complete typed
  plan from Chat, generates semantic blocks with bounded concurrency,
  compiles one document, and publishes after all blocks are generated. Progress
  reaching 100% means block generation finished; compile and publish follow.
  The workflow never validates or asks the block model to retry findings;
  quality verification belongs to the subsequent agent tool loop.
- HTML outline planning returns one whole-artifact narrative and one concrete
  layout intent per block before bounded fan-out. An explicit `page_count` tool
  argument is the only hard quantity signal and chat sets it only for an exact
  count explicitly required by the user; without it, the outline model
  chooses the block count from the brief. Explicit ordered modules in the brief
  retain their order, scope, and coverage. If a valid outline misses an explicit
  count, one conditional structured repair may repartition adjacent content;
  only a failed repair uses the deterministic exact-count fallback.
- Chat is a thin handoff for new HTML: it preserves the user's requirements,
  facts, source data, ordering, visual constraints, and prohibitions in one
  brief, but does not invent page assignments, module merges, layouts,
  narrative, chart placement, appearance, or accent. Those decisions belong to
  executor's structured outline planner.
- `edit_file` reads the latest immutable knowledge revision. It revises all
  blocks by default or only explicit `block_ids`, reusing every other block
  byte-for-byte (including failed placeholders). Failed blocks targeted for
  edit are regenerated; OK blocks not in the edit set reuse stored JSON
  verbatim. Publishing creates a child revision on the same document and accepts
  an optional `expected_object_sha256` compare-and-swap guard.
- The artifact manifest persists the narrative and per-block layout intents.
  Editing remains deterministic: missing historical fields receive static
  defaults, the existing `BlockStrategy` selects reuse/revise/regenerate, and
  the current change request overrides stored planning hints while existing
  HTML remains the source of truth for unaffected content. Editing does not
  invoke a second outline planner.
- The compiler owns the current responsive shell, accessible design tokens,
  typography, spacing, and reusable Grid/Flex layout primitives. Artifact blocks
  own semantic content and may add narrowly scoped topic-specific composition;
  they must not rebuild the page shell or foundational design system. Artifact
  mode selects shell behavior, while appearance and accent remain content-driven.
  Executor's structured outline model resolves one appearance for the whole
  artifact from the complete brief, including explicit negation; ambiguous
  requests default to light. That planned value is immutable for all block
  generations. Every compiled block root is normalized to the shared shell palette, so scoped block
  CSS cannot replace the page canvas with a conflicting light or dark theme;
  topic-specific accents and nested cards remain block-owned. Generation,
  editing, compilation, and validation always use the current code-owned
  contract; there is no application-level template version or compatibility branch.
- Preview HTML runs in an opaque-origin iframe with `sandbox="allow-scripts"`.
  Internal `#fragment` navigation remains available; same-origin access to the
  application is not. Model-authored inline JavaScript and event handlers are
  supported for self-contained interaction, while CSP blocks connections,
  forms, remote scripts, access to the application origin, and top-level navigation.
  The compiler namespaces block-local element IDs and rewrites static JavaScript
  `#id` selectors and `getElementById("id")` calls to the same namespaced IDs;
  generated dynamic selectors should use block-scoped `data-*` attributes.
- Chart artifacts load the pinned full ECharts 6.1.0 runtime from the web
  image at `/runtime/echarts/6.1.0/echarts.min.js`, not a public CDN. The full
  build keeps generated options functional when they use components such as
  tooltip, legend, title, radar, or gauge.
  The platform build copies the package-owned file into its dist; nginx serves
  the versioned path with immutable caching and anonymous CORS for SRI. HTML
  preview uses the same short-lived Knowledge resource URL capability as
  video/audio/PDF instead of copying document bytes into `iframe.srcDoc`.
- Chat owns the canonical AST-based HTML/CSS validator. It reports stable
  error/warning codes with block, selector, evidence, and repair suggestions.
  `validate_html` runs deterministic AST/CSS checks first. Hard errors include a
  compact reason and evidence. The primary ToolLoopAgent decides block-addressed
  `edit_file` repair → `validate_html` rounds from those results. Heuristic
  responsive findings remain warnings. Only after the hard gate passes does one
  whole-artifact model review compare persisted blocks with their explicit
  content contracts. Its deduplicated findings are non-blocking advisories with
  contract item, reason, evidence, and suggestion; they never change `ok`. The
  primary agent may repair a clearly evidenced explicit-requirement violation
  but must not chase subjective review findings to zero. Tool execution errors
  and unaddressable document-level hard errors prevent a successful validation claim.
  Harness-forced terminal quality-gate responses are emitted by a deterministic
  zero-token text model. A provider cannot turn a forbidden final-step tool call
  into raw tool-protocol text in the user-visible SSE stream.
  Chat classifies the report into the compact
  `{ ok, content_sha256, errors, advisories }` decision and verifies the current
  Knowledge revision hash before orchestrating repair.
  These diagnostics are retained in native tool parts and traces and rendered
  as an ordinary visible tool part. The hash-bound report is
  returned only by `validate_html`; `write_html`/`edit_file` carry no advisory
  report. `validate_html` reads the current bytes from Knowledge and reruns the
  same canonical validator after any edit. HTML does not enter chat history.
- Validation and repair use ordinary native tool calls in the primary
  ToolLoopAgent. `prepareStep` derives only the pending validation document from
  this run's native tool results and forces `validate_html`; it does not maintain
  a persisted artifact state machine or forge model streams. Reviewer JSON
  requires concrete contract/reason/evidence fields, is normalized and retried
  once, and is discarded on persistent format failure without suppressing
  deterministic results.
- Every compiled ECharts option receives a default tooltip when the fragment did
  not declare one. Validation still reports `CHART_TOOLTIP_MISSING` on persisted
  artifacts so legacy output is repaired block-by-block rather than silently
  accepted.
- Standard bar, line, area, pie, and radar charts use the compact `data-chart`
  shorthand. Validation-directed repairs prefer that shorthand so a block model
  does not repeatedly hand-write deeply nested ECharts JSON; `data-chart-option`
  remains available for chart types the shorthand cannot express. Radar series
  must contain one finite numeric value per indicator and are rejected rather
  than padded or truncated, so validation never fabricates chart data.
- The web client auto-continues only tools explicitly marked for client execution.
  Completed durable server tools are never echoed as client tool responses.
- `validate_html` is read-only and never executes model-authored HTML. Automated
  browser screenshots and computed-layout inspection remain outside this phase;
  user-provided screenshots can drive a later `edit_file` turn.
- `write_plan` creates revision 1. `update_plan` performs compare-and-swap and
  returns conflicts as tool output rather than terminating the UI stream.
- Memory tools create pending candidates. `update_memory` links the candidate
  to the active memory it supersedes; approval remains asynchronous in the
  memory panel.

## Rationale

Large HTML passed through repeated ToolLoop tool arguments consumes model
steps and context in proportion to page count. It also makes 100-page output
depend on a 100-step loop. A single high-level tool keeps the conversational
agent responsible for intent while a deterministic file pipeline handles
fan-out, validation, persistence, and compilation.

Raw host shell access and same-origin model HTML would give untrusted model
output access to service credentials or browser state. Neither is necessary
for office artifact generation.

A thin reset plus unconstrained per-block CSS made every model call reinvent
responsive layout and allowed malformed output to reach publication. The
compiler-owned template reduces the generation search space, while structured
findings create an inspect-and-repair loop without adding a verifier persona or
a browser dependency to the durable workflow.

Static validation is intentionally an inline tool call rather than another
durable Workflow run. Deterministic checks return structured findings directly
to the ToolLoopAgent, which reviews, targets `block_id` with `edit_file`, and
reruns the validator when appropriate. Workflow remains the
boundary for long-running, restartable generation. Human-in-the-loop applies to
final acceptance, subjective feedback, and risky approvals—not routine QA or
repair orchestration.

## Consequences

- One `write_html` call can generate up to 100 blocks without consuming one
  ToolLoop step per block. Four block model calls run concurrently and all
  inherit the parent AbortSignal.
- A failed block, invalid chart, broken navigation target, or responsive finding
  may publish as an intermediate revision; the primary agent receives the
  validation result and can repair it in the same turn. An edit failure preserves
  the previously published document.
- Artifact edits use the current compiler and prompt directly; no stored version
  chooses an alternate template, validation rule, or migration path.
- HTML directories and teaching-course navigation use stable block IDs and
  ordinary fragment links.
- The full ECharts runtime is served from a fixed, versioned same-origin URL and
  reused from the browser cache after the first request; first load does not
  depend on jsDelivr.
- Active process loss still cancels the run; completed blocks and revisions
  remain in knowledge for later product-level recovery work.
