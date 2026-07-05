# ADR 0023: Agent tool contracts, capability projection, and policy

## Status

Accepted. Supersedes the public tool naming and catalog composition decisions in
ADR 0012 while preserving its high-level artifact pipeline. Refines ADR 0017 and
ADR 0022 by removing todo identifiers from deliverable tool inputs.

## Context

The chat ToolLoopAgent accumulated fifteen built-in tools across files organized
by implementation history rather than capability. Several public names no
longer described their behavior: `write_file` generated an artifact from a
brief, `edit_file` performed an LLM revision, and `run_command` only inspected
HTML. Tool availability, side effects, execution duration, approval, UI
rendering, and plan-mode behavior were inferred from names or hard-coded in
separate layers.

Plan mode kept execution tools visible and replaced their `execute` functions
with inert responses. This let the model understand future capabilities, but it
also spent context on unusable schemas, invited invalid calls, and did not cover
tools contributed by extensions. Tool failures returned as ordinary successful
results, outputs were untyped, and frontend cards selected renderers by public
tool name.

AI SDK 7 provides the required native boundaries: flat typed tools,
`outputSchema`, tool metadata, per-tool context, `activeTools`, centralized
`toolApproval`, lifecycle callbacks, and preliminary async-iterable outputs.
MCP 2025-11-25 provides a compatible risk vocabulary through read-only,
destructive, idempotent, and open-world annotations. Codex, Claude Code, and
Cursor separate capability availability from approval and keep their core tool
surface small.

## Decision

1. Keep one ToolLoopAgent and one flat AI SDK ToolSet. Internal files group
   related definitions, but no category dispatcher or nested agent runtime is
   introduced.
2. Every built-in has a manifest entry containing its AI SDK tool plus
   capability, effect, trust, execution, mode, and UI metadata. The manifest is
   composition data only; AI SDK `tool()` remains the execution primitive.
3. Plan mode receives only research, interaction, todo, and plan-persistence
   tools through catalog resolution. It receives a compact
   `<execution_capabilities>` projection generated from the same manifests, so
   it can plan artifact, image, and video work without being able to call those
   tools.
4. Approval is centralized in the ToolLoopAgent. Built-in additive operations
   remain automatic. Unknown MCP actions require user approval; destructive MCP
   actions cannot be auto-approved. Tool annotations from untrusted MCP servers
   are hints, not authorization.
5. Public built-in names become:
   - search: `web_search`, `knowledge_search`
   - files: `list_files`, `read_file`
   - planning: `write_plan`, `update_plan`, `update_todos`
   - interaction: `ask_user`
   - artifacts: `write_file`, `edit_file`, `html_validate`
   - media: `generate_image`, `generate_video`
   - memory: `create_memory`, `update_memory`

   `generate_video` remains format-neutral because horizontal and long-form
   generation are expected later; current short-drama constraints remain in its
   schema and description. MCP names use `mcp__<server>__<tool>`.
6. Tool outputs use explicit schemas. Expected business blockers return typed
   results; execution and infrastructure failures throw so AI SDK emits native
   tool-error parts and observability records failures correctly.
7. Tool metadata selects frontend renderers. Public names remain useful for
   traces and policy, but frontend components do not use them as the UI type
   system.
8. Deliverable tools no longer accept `todo_id`. `update_todos` remains the
   canonical progress state and the model reconciles it after tool completion.
   Long-running tool cards continue to stream their own progress independently.
   (Refined by ADR 0024: the `todo_id` on tool inputs stays removed, but
   `update_todos` items gain an optional `deliverable` tag so the frontend can
   advance each tagged todo live from its deliverable card, without waiting for
   the model's next-step reconcile.)
9. Long-running executor start/poll/cancel helpers live under `agent/tasks/`,
   not `agent/tools/`. Tool files remain thin model-call adapters.
10. Backend AI SDK dependencies are declared once in the pnpm workspace catalog
    and consumed by chat, executor, and transport-ts. Compatible major ranges
    replace service-specific resolutions and the physical-copy override.

## Consequences

- The rename is intentionally incompatible. Persisted tool parts from the demo
  phase are not rewritten and no alias tools are retained.
- Plan quality does not depend on exposing inert execution schemas. Provider
  availability and prerequisites appear in the generated capability projection.
- Tool policy can evolve independently along effect, trust, execution, and
  source dimensions instead of overloading a `sideEffecting` group.
- Frontend and observability consume stable metadata and typed outputs instead
  of reverse-engineering behavior from names.
- ADR 0017's per-deliverable live todo completion is removed. Artifact and media
  cards still show live task status; the todo snapshot updates on the next agent
  step. **(Reinstated by ADR 0024 via a `deliverable` tag on todo items — the
  frontend advances each tagged todo from its live deliverable card, so
  html/images/video no longer wait for the slowest sibling.)**

## References

Verified on 2026-07-04:

- [AI SDK `ToolLoopAgent`](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool-loop-agent)
  and [`tool()`](https://ai-sdk.dev/docs/reference/ai-sdk-core/tool) define the
  native loop, active-tool, approval, metadata, schema, and lifecycle boundaries.
- [Model Context Protocol tool annotations](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
  define read-only, destructive, idempotent, and open-world hints without making
  server-provided annotations an authorization boundary.
- [Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
  and [sandbox design](https://openai.com/index/building-codex-windows-sandbox/)
  separate the model-visible tool contract from runtime enforcement and approval.
- [Claude Code permissions](https://code.claude.com/docs/en/permissions) use
  mode-aware allow, ask, and deny policy with read-only operations as the low-risk
  baseline.
- [Cursor Composer 2 technical report](https://cursor.com/resources/Composer2.pdf)
  documents a small general tool surface and environment-specific dynamic tool
  availability in the production harness.
