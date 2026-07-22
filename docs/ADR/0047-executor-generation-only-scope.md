# ADR 0047: Executor is generation-workflow only

## Status

Accepted, superseded in part by ADR 0048. Executor remains generation-only;
ADR 0048 restores HTML validation as the Chat-local `validate_html` tool.

## Context

Executor had accumulated three unrelated entry shapes: durable HTML generation,
durable video generation, and a synchronous HTML validation/model-review route.
It also retained an `echo` workflow used only as an early smoke path. The latter
two paths no longer represented product requirements and expanded the server's
route, tool, prompt, transport, and documentation surface.

Workflow DevKit 4.5 defines workflow functions as deterministic durable
orchestrators and step functions as the side-effect boundary. Its runtime
`start()` API enqueues a workflow and returns immediately. The executor's generic
task API already matches that contract; synchronous artifact review does not.

## Decision

- Executor registers exactly two TaskTypes: `html-artifact` and
  `video-generation`.
- `/tasks` remains the common start/read/cancel API for those workflows.
- `/video-productions` remains because it is the durable projection and approval
  surface consumed by `video-generation`; it is not a third workflow type.
- Delete the `echo` workflow and the synchronous `/html-validations` route,
  validator, reviewer, decision DTOs, generated contract, transport client, chat
  tool, prompt policy, and frontend special case.
- HTML template versioning remains compiler-owned because it is part of generated
  document format, not a validation domain.

## Consequences

Executor has one responsibility: durable HTML/video generation and the state
needed to operate those workflows. Chat owns mandatory validation and the
Agent-led `validate_html` → `edit_file` repair loop. Executor retains no
validation endpoint or compatibility alias.

The benchmark-agent alignment is a smaller explicit tool/runtime surface: the
primary agent owns the interaction loop while bounded durable production work is
delegated to the executor. No additional agents, personas, schedulers, or custom
workflow primitives are introduced.

## References

- Installed `workflow@4.5.0`:
  `docs/how-it-works/understanding-directives.mdx`
- Installed `workflow@4.5.0`:
  `docs/api-reference/workflow-api/start.mdx`
- Installed `ai@7.0.26`: `docs/03-agents/03-workflows.mdx`
