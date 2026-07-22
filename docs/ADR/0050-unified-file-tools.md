# ADR 0050: Unified file tools and full-replacement Markdown writes

## Status

Accepted.

## Context

Chat exposed file reads, generated artifacts, and plan persistence as three
capabilities even though all are conversation files stored by Knowledge.
Markdown had three overlapping write paths: `write_markdown`, `write_plan`, and
`update_plan`. The first invoked a second LLM from inside the tool, while the
plan pair differed only by create/update persistence mechanics and exposed a
revision token to the model.

AI SDK tools work best when names express one stable side effect and schemas
contain the complete input required for that effect. Claude Code's Write tool
and coding-agent file writes likewise treat full-file replacement as one
operation; create versus overwrite is determined by whether the target exists,
not by separate reasoning tools.

## Decision

- One `files` capability owns list/read, Markdown writes, HTML generation,
  HTML block editing, inspection, and validation. The former artifact tool
  module and capability are removed.
- `write_markdown` is the only Markdown persistence tool. It always receives
  complete Markdown content. Omitting `file_id` creates a document; providing
  it overwrites that conversation Markdown document in full.
- `write_plan` and `update_plan` are removed. In Plan mode, `write_markdown`
  normalizes the filename to `*-plan.md`, validates the required headings and
  checklist, and records the document as the conversation's active Plan.
- Markdown no longer invokes a nested generation or revision LLM. The primary
  ToolLoopAgent writes the complete content from its full context directly in
  the native function call.
- `edit_file` is HTML-only because its block-addressed durable workflow is a
  genuinely different operation. Markdown revisions use `read_file` followed
  by full replacement through `write_markdown(file_id)`.
- Plan-mode batch exclusivity is mode-aware: `ask_user` conflicts with
  `write_markdown` only in Plan mode. Normal-mode Markdown may still run beside
  independent HTML, image, or video deliverables in the same AI SDK step.

## Consequences

- The model sees fewer tools and no duplicate Markdown schemas or plan revision
  tokens.
- Markdown writes consume one primary-agent model call and one persistence
  operation instead of a nested LLM call.
- Overwriting Markdown is intentionally last-write-wins. This matches the
  requested whole-file semantics; HTML keeps revision-aware block editing.
- The change is intentionally incompatible during the demo phase. No aliases or
  compatibility branches retain `write_plan`, `update_plan`, or Markdown
  `edit_file` behavior.
