# ADR 0055: Generic file tools with a thin agent harness

## Status

Accepted

Supersedes the artifact/file-tool portions of ADR-0012, ADR-0023, ADR-0035,
ADR-0048, ADR-0049, ADR-0050, and ADR-0054.

## Context

The chat agent currently exposes Markdown and HTML-specific write/edit tools.
HTML edits invoke a durable Executor workflow that asks a second model to
regenerate a block from a brief. This makes a small code change pay the cost of
an artifact workflow and prevents the primary agent from producing an exact
replacement. HTML generation also mixes durable materialization, compilation,
publication, and validation in one service boundary.

ADR-0054/v1.9.0 correctly addressed unchanged-block reuse and stale concurrent
publication. The target model still needs both properties, but a path tree with
per-file SHA values can provide them without a revision graph: unchanged page
files keep their bytes and SHA, while a deliverable change set compares its
baseline at promotion time.

## Decision

1. The model-facing file capability is one generic protocol: `list_files`,
   `read_file`, `write_file`, `edit_file`, `search_files`, and `check_file`.
   Text writes are exact UTF-8 writes; edits use Pi-style unique,
   non-overlapping `{old_text,new_text}` replacements applied atomically to one
   source. `write_file` never interprets content as a generation request.
2. `expected_sha256` is optional on individual writes/edits. Cross-run
   concurrency is owned by a host-only change-set store: a deliverable records
   baseline path SHAs and promotion fails atomically if any target changed.
3. Knowledge owns the Web virtual FileStore and deliverable change sets. Chat
   and Executor use its internal transport API; neither service accesses the
   other service's storage or exposes host filesystem commands.
4. Every direct `write_file` and `edit_file`, including HTML, promotes its
   change set immediately and produces a readable version. HTML is not held in
   a private staging state pending validation. `check_file` is a read-only
   diagnostic tool and never publishes, rejects, rewrites, or otherwise gates a
   file.
5. HTML uses the same exact `write_file` and `edit_file` contract as every other
   text format and stays in the primary `ToolLoopAgent` by default. The primary
   model may write one complete document or materialize a larger site over
   several ordinary tool-loop steps. The generic `delegate_tasks` tool remains
   an optional escape hatch only when genuinely independent outputs exceed the
   primary model's practical output or context budget. No page-count threshold
   or HTML routing policy is encoded in the harness.
6. `delegate_tasks` accepts a shared immutable context plus independent
   `{id,instruction,output_path}` tasks. Chat freezes that payload, creates one
   deliverable change set, and starts the generic Executor `file-task-batch`
   task. Each Workflow step performs one context-free model generation and
   writes one unique path; duplicate output paths are rejected. Workers never
   edit the same file and never receive personas, planning authority, or the
   accumulated chat context.
7. Workflow remains an internal durability and bounded-fan-out substrate. It
   owns cancellation, retry checkpoints, progress, and process-loss recovery,
   but it does not understand HTML briefs, themes, outlines, or repair policy.
   `generate_files` and the `html-artifact` task type are removed rather than
   retained as aliases.
8. Delegated tasks materialize independent exact files and Chat atomically
   promotes the completed batch. Chat does not compile HTML fragments, derive an
   `index.html`, impose an artifact shell, or validate delegated output before
   publication. When several files must compose one HTML application, the
   primary agent owns that composition through ordinary file tools.
9. The Knowledge migration is intentionally destructive in demo phase: drop
   revision and block-version tables/current revision pointer, create the
   generic current-tree/change-set storage, and do not migrate old generated
   HTML. User-uploaded source documents remain intact.
10. HTML quality control is prompt-directed rather than runtime-orchestrated.
    For important, scripted, or structurally complex HTML, the primary agent is
    instructed to call `check_file`, interpret its syntax and link diagnostics,
    and perform exact edits when useful. `prepareStep` does not force tool
    selection, maintain a verification state machine, or stop delivery because
    a diagnostic remains.
11. UI progress, diffs, diagnostics, and promotion status use official AI SDK
   `tool-*` parts and metadata. No duplicate custom progress part is added.
12. HTML is a complete browser artifact format, not a static-document subset.
    Direct and delegated output may use JavaScript, modules, dynamic DOM,
    Canvas, SVG, WebGL, forms, media, external runtimes, and browser events.
    The generation harness must not strip those capabilities or reject them as
    validation errors. Untrusted execution is isolated by an iframe sandbox
    that grants scripts and interaction capabilities but deliberately omits
    `allow-same-origin` and top-level navigation. The opaque origin, rather than
    content rewriting, is the security boundary.

## Consequences

The primary agent creates, checks, and repairs HTML without an HTML-specific
protocol. Direct writes become visible immediately, so lightweight reports do
not pay compilation or mandatory-validation latency and later changes remain
precise edits against one coherent document. Large artifacts remain in the
primary context across multiple tool-loop steps; generic context-free fan-out is
available but is no longer the recommended HTML path.

Reports, dashboards, H5 games, simulations, and long interactive teaching
courseware share the same file tools. Artifact type and generation scale are
orthogonal: interactive output may be direct or delegated, and delegated output
is not assumed to be static.

Web deployments have a safe virtual root and no shell access; a future Electron
driver can bind the same operations to a user-selected directory.

This is a breaking cross-service refactor. The old HTML tools, compiler, shell
contract, verification state machine, format-specific generation tool,
HTML-specific task type, and compatibility branches are removed rather than
retained as a dual runtime.

## References

- [ADR-0035: tool orchestration and unified progress stream](0035-tool-orchestration-and-unified-progress-stream.md)
- [ADR-0050: unified file tools](0050-unified-file-tools.md)
- [ADR-0054: content-addressed artifact revisions](0054-content-addressed-artifact-revisions.md)
- [Pi edit operations](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/tools/edit.ts)
- [Vercel AI SDK agents](https://ai-sdk.dev/docs/agents)
- [Vercel AI SDK subagents](https://ai-sdk.dev/docs/agents/subagents)
- [Claude Code tools](https://code.claude.com/docs/en/tools-reference)
- [Claude Agent SDK loop](https://code.claude.com/docs/en/agent-sdk/agent-loop)
- [Cursor agent best practices](https://cursor.com/blog/agent-best-practices)
- [WHATWG HTML iframe sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html)
- [MDN iframe sandbox tokens](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe)
