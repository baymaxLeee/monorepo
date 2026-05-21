# Agent Infrastructure

Shared workspace for ALL coding agents. Tool-agnostic (Claude / Codex / Cursor).

## Layout

- `playbooks/`  — Step-by-step checklists for the main fullstack agent
- `subagents/`  — Definitions for narrow specialist sub-agents
- `scopes/`     — Self-imposed guard rails (free / caution / forbidden)
- `tasks/`      — Runtime blackboard per task (gitignored except `_template/`)

## Multi-agent model

**Default**: one main fullstack agent works in a single context window
spanning frontend + backend. Switch stacks by `cd`, not by handing off.

**Sub-agents are narrow specialists**, used only for:
1. Context-free grunt work (codegen, mass rename)
2. Fresh-eyes review (audit without design bias)
3. Read-only exploration (deep digs that would pollute main context)

Do NOT dispatch a "frontend agent" and "backend agent" for the same feature —
they have independent context windows and lose all your cross-stack reasoning.

## Task ledger pattern (optional, for long tasks)

For multi-step tasks, the main agent can create `.agents/tasks/<task-id>/`:
- `plan.md`     — overall plan, updated as work progresses
- `status.md`   — append-only event log
- `artifacts/`  — intermediate outputs

This survives `/clear` and allows resumption.

## See also

- Root `AGENTS.md` — universal rules
- `playbooks/full-stack-feature.md` — most common workflow
