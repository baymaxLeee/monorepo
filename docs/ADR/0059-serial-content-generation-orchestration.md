# ADR 0059: Serial content-generation orchestration

## Status

Accepted. Supersedes ADR 0022 and amends ADR 0024 and ADR 0035.

## Context

The primary ToolLoopAgent previously instructed the model to co-emit independent
Markdown, HTML, image, and video generation calls. That described concurrency
which did not match the product's common execution shape: one primary agent owns
the shared context and normally materializes each coherent deliverable itself.
Splitting one HTML document into independently generated fragments is especially
unsafe because CSS, DOM identifiers, scripts, navigation state, and narrative
structure are shared.

There is one narrower, real fan-out case: `delegate_tasks` generates two or more
independent complete files through Executor and atomically promotes the
successful batch. Its progress remains visible through preliminary official tool
results carried by the existing status stream.

## Decision

1. Keep AI SDK provider parallel tool calls enabled. Independent read-only
   research and context tools may still share a model step; this ADR does not
   impose a one-tool-per-step runtime scheduler.
2. Serialize content generation in the Agent contracts and Plan checklist.
   `write_file`, `edit_file`, `generate_images`, and
   `create_video_production` must observe the prior generation result before the
   next deliverable starts.
3. Keep `delegate_tasks` as the sole explicitly concurrent generation
   capability. It may fan out internally only across independent complete output
   paths and occupies one deliverable slot in the serial plan.
4. Process multiple `generate_images` prompts sequentially inside one tool call,
   while preserving one gallery card and partial-success semantics.
5. Keep at most one todo `in_progress`. `update_todos` is called alone before a
   serial deliverable and again after its result to advance the ordered
   checklist. A whole image batch or delegated file batch is one todo.
6. Preserve the Workflow-backed task-status SSE and preliminary tool-result
   projection for delegated files and video. Serial orchestration changes when
   generation starts, not how durable progress is transported.
7. Do not restore HTML fragments, an artifact shell/compiler, or cross-model
   assembly. A coherent HTML file remains owned by the primary agent.

## Consequences

- Prompts and Todo UI now describe the execution that actually occurs.
- Normal generation trades speculative cross-deliverable overlap for complete
  shared context and deterministic order.
- Rare large multi-file batches retain bounded fan-out, cancellation,
  failure-without-publication, atomic promotion, and progress reporting.
- Video Workflow stages after `create_video_production` returns remain
  independently durable; this ADR only serializes chat-level generation calls.
