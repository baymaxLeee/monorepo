# ADR 0012: High-level file tools and block-revision HTML artifacts

## Status

Superseded in part by ADR 0023. The artifact pipeline remains accepted; ADR
0023 owns current public names, manifests, policy, and directory structure.

## Decision

- The ToolLoopAgent exposes a compact, flat public tool set grouped internally
  by capability. See ADR 0023 for the complete current list.
- `write_file` is the only HTML creation entry point. Its execute function
  plans a typed outline, generates semantic blocks with bounded concurrency,
  compiles one document, and publishes after all blocks are generated. Progress
  reaching 100% means block generation finished; compile and publish follow.
  The workflow never validates or asks the block model to retry findings;
  quality verification belongs to the subsequent agent tool loop.
- `edit_file` reads the latest immutable knowledge revision. It revises all
  blocks by default or only explicit `block_ids`, reusing every other block
  byte-for-byte (including failed placeholders). Failed blocks targeted for
  edit are regenerated; OK blocks not in the edit set reuse stored JSON
  verbatim. Publishing creates a child revision on the same document and accepts
  an optional `expected_object_sha256` compare-and-swap guard.
- The compiler owns a versioned responsive shell, accessible design tokens,
  typography, spacing, and reusable Grid/Flex layout primitives. Artifact blocks
  own semantic content and may add narrowly scoped topic-specific composition;
  they must not rebuild the page shell or foundational design system. Artifact
  mode selects shell behavior, while appearance and accent remain content-driven.
- Preview HTML runs in an opaque-origin iframe with `sandbox="allow-scripts"`.
  Internal `#fragment` navigation remains available; same-origin access to the
  application is not.
- Chart artifacts load the pinned full ECharts 6.1.0 runtime from the web
  image at `/runtime/echarts/6.1.0/echarts.min.js`, not a public CDN. The full
  build keeps generated options functional when they use components such as
  tooltip, legend, title, radar, or gauge.
  The platform build copies the package-owned file into its dist; nginx serves
  the versioned path with immutable caching and anonymous CORS for SRI. Because
  preview `srcdoc` keeps an opaque origin, the chat preview adds only that exact
  deployment URL to the compiler-owned CSP instead of enabling same-origin
  iframe access.
- Executor owns the canonical AST-based HTML/CSS validator. It reports stable
  error/warning codes with block, selector, evidence, and repair suggestions.
  `html_validate` combines deterministic AST/CSS checks with model review of
  persisted block contracts, generated fragments, and the whole outline. After
  every successful HTML `write_file` or `edit_file`, the ToolLoopAgent harness
  enforces an internal `html_validate` quality gate. Actionable findings trigger
  block-addressed `edit_file` repair → `html_validate` rounds until no
  actionable findings remain. Tool execution errors and unaddressable
  document-level findings fail the gate closed.
  These diagnostics are retained in native tool parts and traces and rendered
  as an ordinary visible tool part. The hash-bound report is
  returned only by `html_validate`; `write_file`/`edit_file` carry no advisory report.
  `html_validate` sends the document identity to executor's synchronous internal
  validation endpoint; executor reads current bytes from Knowledge and reruns the
  same canonical validator after any edit. Chat has no duplicate validator and
  HTML does not enter chat history.
- The forced validation step uses `prepareStep` to inject a deterministic native
  tool-call stream, so provider-specific tool-call generation cannot skip the
  mandatory gate. Tool execution failures fail the gate. Reviewer JSON is
  normalized and retried once without suppressing deterministic results.
- Every compiled ECharts option receives a default tooltip when the fragment did
  not declare one. Validation still reports `CHART_TOOLTIP_MISSING` on persisted
  artifacts so legacy output is repaired block-by-block rather than silently
  accepted.
- The web client auto-continues only tools explicitly marked for client execution.
  Completed durable server tools are never echoed as client tool responses.
- `html_validate` is read-only and never executes model-authored HTML. Automated
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
versioned template reduces the generation search space, while structured
findings create an inspect-and-repair loop without adding a verifier persona or
a browser dependency to the durable workflow.

Static validation is intentionally an inline tool call rather than another
durable Workflow run. Deterministic checks return structured findings directly
to the ToolLoopAgent; the harness forces the agent to target `block_id` with
`edit_file` and rerun the validator in the same turn. Workflow remains the
boundary for long-running, restartable generation. Human-in-the-loop applies to
final acceptance, subjective feedback, and risky approvals—not routine QA or
repair orchestration.

## Consequences

- One `write_file` call can generate up to 100 blocks without consuming one
  ToolLoop step per block. Four block model calls run concurrently and all
  inherit the parent AbortSignal.
- A failed block, invalid chart, broken navigation target, or responsive finding
  may publish as an intermediate advisory revision; the internal quality gate
  repairs it before the turn completes. Security and shell-integrity findings
  block publication. An edit failure preserves the previously published
  document.
- Existing artifacts without the current `templateVersion` are regenerated on
  their next edit; no legacy template compatibility branch is retained during
  the demo phase.
- HTML directories and teaching-course navigation use stable block IDs and
  ordinary fragment links.
- The full ECharts runtime is served from a fixed, versioned same-origin URL and
  reused from the browser cache after the first request; first load does not
  depend on jsDelivr.
- Active process loss still cancels the run; completed blocks and revisions
  remain in knowledge for later product-level recovery work.
