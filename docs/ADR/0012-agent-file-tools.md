# ADR 0012: High-level file tools and block-revision HTML artifacts

## Status

Accepted. Supersedes the artifact protocol in ADR 0010 and ADR 0011.

## Decision

- The ToolLoopAgent exposes a compact public tool set: `list_files`,
  `read_file`, `write_file`, `edit_file`, `run_command`, `web_search`,
  `ask_user`, `write_plan`, `update_plan`, `create_memory`, and
  `update_memory`.
- `write_file` is the only HTML creation entry point. Its execute function
  plans a typed outline, generates semantic blocks with bounded concurrency,
  sanitizes and persists every block, compiles one document, and publishes
  only when every block is present.
- `edit_file` reads the latest immutable knowledge revision. It revises all
  blocks by default or only explicit `block_ids`, reusing every other block
  byte-for-byte. Publishing creates a child revision on the same document.
- Artifact blocks own their semantic HTML, scoped CSS, theme, layout, and chart
  options. The compiler owns only section IDs, CSS/network sanitization, CSP,
  ECharts hydration, and runtime error handling; artifact mode expresses content
  intent and must not select a fixed visual template or color scheme.
- Preview HTML runs in an opaque-origin iframe with `sandbox="allow-scripts"`.
  Internal `#fragment` navigation remains available; same-origin access to the
  application is not.
- `run_command` is a small set of read-only file validators. It is explicitly
  not host shell access; arbitrary execution requires a future isolated
  sandbox product boundary.
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

## Consequences

- One `write_file` call can generate up to 100 blocks without consuming one
  ToolLoop step per block. Four block model calls run concurrently and all
  inherit the parent AbortSignal.
- A failed or missing block leaves an incomplete generation but never a
  published partial revision.
- HTML directories and teaching-course navigation use stable block IDs and
  ordinary fragment links.
- Active process loss still cancels the run; completed blocks and revisions
  remain in knowledge for later product-level recovery work.
