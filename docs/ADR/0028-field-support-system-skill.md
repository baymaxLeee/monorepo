# ADR 0028: Field support as a progressively disclosed system Skill

## Status

Superseded by ADR-0033. The code-governed `field-support` package was removed;
all Skills are Admin-managed, published, enabled, and explicitly bound to Bots.

## Context

ADR-0026 introduced an oncall bot persona over org-shared knowledge. The actual
product scenario is B2B front-line, field, on-site, and after-sales support for
customer product problems, not live production SRE incident response.

A first implementation added a global `oncall_investigate` tool containing two
nested model calls, retrieval orchestration, a private three-state schema, and
knowledge-governance fields. Review rejected that shape:

- intake policy, evidence rules, escalation criteria, and response templates are
  model guidance and do not require a model-facing execution primitive;
- the main `ToolLoopAgent` already owns the reasoning loop and exposes the
  general `ask_user`, `knowledge_search`, `web_search`, and `write_file` tools;
- a global vertical tool permanently expands every agent's tool surface and
  duplicates the main model's reasoning;
- `knowledge_version`, authority, and review metadata had no complete curation UI
  or retrieval policy, so they were speculative schema rather than a working
  product capability.

Claude Code, Codex, and Cursor keep a small general tool surface and progressively
disclose specialized instructions. This repository already defines the same
Skill boundary in ADR-0018 planning: advertise compact metadata, then load the
full Skill only when the task matches.

## Decision

1. Chat has one primary AI SDK `ToolLoopAgent`. Field support does not introduce
   another agent, a manual model loop, or a durable workflow.
2. `field-support` is a code-versioned system Skill stored under
   `agent/integrations/skills/field-support/SKILL.md`.
3. Normal-mode runs receive only `<available_skills>` entries containing each
   Skill's name and description. Plan mode receives neither this execution Skill
   nor its loader.
4. The single general `load_skill` tool loads a named system Skill on demand and
   returns its complete instructions through AI SDK `toModelOutput`.
5. The Skill instructs the main agent to gather missing facts with `ask_user`,
   retrieve private evidence with `knowledge_search`, use `web_search` only for
   public/current information, and create a handoff artifact with `write_file`
   only when requested.
6. Resolution, clarification, escalation, citation discipline, and output
   templates live in the Skill. There is no dedicated `oncall_investigate` tool
   or compatibility alias.
7. Knowledge remains responsible for parsing, chunking, embedding, BM25, RRF,
   reranking, org ACL, and chunk-level citations. Governance/version fields are
   deferred until a concrete operational workflow and ranking policy require
   them.
8. The run `AbortSignal` is propagated through `knowledge_search` into the
   transport client so Stop cancels in-flight private retrieval.
9. Each run constructs its own `ToolCatalog`; the unused process-global catalog
   registration API is removed so future MCP or tenant extensions cannot leak
   across runs.

## Consequences

- Specialized instructions consume full context only when relevant.
- Field support uses the same model loop, approval policy, trace lifecycle, and
  cancellation semantics as the rest of Chat.
- Adding another system Skill requires one registry entry and one `SKILL.md`, not
  another global business tool.
- The Skill provides behavioral structure, not a machine API contract. If a
  future external consumer requires strict JSON or a real ticket mutation, that
  operation gets its own typed and approval-aware domain tool.
- No knowledge migration, OpenAPI change, generated client change, or admin CRUD
  surface is introduced for speculative governance metadata.

## References

- ADR-0011: ToolLoopAgent core
- ADR-0018 plan: Skill progressive disclosure and run-scoped extensions
- ADR-0023: tool contracts and small flat ToolSet
- `apps/backend/services/chat/src/agent/README.md`
- `docs/plans/agent-extensions-mcp-skill-subagent.md`
