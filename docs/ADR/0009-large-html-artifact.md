# ADR 0009: Large HTML artifacts via a single block-compile workflow

## Status

Superseded by ADR 0010. This file records the former child-workflow design.

## Decision

- Generate every HTML artifact through one path: the durable
  `artifactGenerationWorkflow` (plan → parallel block generation → compile).
  The legacy single-shot `generateText` HTML path (capped at ~20k output
  tokens) is removed; short documents are simply a 2–3 block plan.
- Charts are emitted by block generation as
  `<div data-chart-option="{escaped JSON}">` and never as raw `<script>`.
  Block output stays pure semantic HTML; the trusted compile step injects the
  ECharts CDN (only when charts exist), a CSP meta, an error boundary, and a
  single hydration script that reads each `data-chart-option` and initializes
  ECharts with `ResizeObserver`.
- Compile validates each chart's option JSON. An unparseable option degrades to
  visible text instead of an empty box; one bad chart never blanks the page.
- A single block failure must not abort the document. Failed blocks persist an
  `{ error }` placeholder; compile renders them in plan order as a visible
  error section and reports `blocks_ok` / `blocks_failed` back to the agent.
- Block-generation progress (`blocks_total` / `blocks_done`) is mirrored from
  the separate artifact workflow onto the chat run's artifact stream by polling
  the generation row, so the user sees "N/M pages" without the artifact
  workflow writing to the chat stream directly.
- `mode` (`document` / `presentation` / `dashboard`) selects compile CSS and a
  plan-prompt hint only; it does not add a code path.
- The artifact tool shares the main agent's context (`runId`, `userId`,
  `conversationId`, `providerId`); long-form generation fans out into
  `'use step'` blocks, not sub-agents or sub-workflows beyond the one durable
  artifact workflow.

## Rationale

A single model call cannot produce 10–100 page documents: it exceeds output
limits and truncates mid-structure. Planning then generating independent blocks
in parallel is the only shape that scales to that length while staying
resumable. Keeping two HTML paths (single-shot vs. workflow) meant two prompts,
two shells, and two CSP behaviors that drifted — notably, the workflow path
shipped chart `<div>`s that nothing hydrated and no CDN, so charts never
rendered. Centralizing the runtime in compile (and forbidding block-level JS)
makes charts work, keeps the sandboxed iframe (`sandbox="allow-scripts"`, no
same-origin) safe, and gives one place to evolve the document shell.

Polling the generation row for progress avoids cross-run stream plumbing: the
artifact workflow is a distinct durable run, so its `getWritable` stream is not
the one the browser reads. The chat tool already awaits the workflow result, so
it is the natural place to surface progress.

## Consequences

- Charts in long-form artifacts render reliably; chart data must be inline in
  the option JSON because CSP `connect-src 'none'` blocks chart-time fetches.
- Documents survive partial failure; the agent can re-run `update_artifact` for
  failed sections using the returned counts.
- The chat run holds open a 1.5s polling loop for the artifact workflow's
  duration; acceptable for an explicitly long-running generation.
- ECharts is pinned by URL + SRI integrity; CDN outage falls back to visible
  text via the hydration script and error boundary.
