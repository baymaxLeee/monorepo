# Agent workspace

The root [AGENTS.md](../AGENTS.md) routes work for every coding tool.
`just context <path-or-target>` shows rules and consumers; `just repo-map --json`
exposes the project graph without source dumps.

- `skills/`: tool-independent workflows, loaded for matching tasks.
- `playbooks/`: implementation and verification routes.
- `scopes/`: scope guidance subordinate to the authorized task.
- `subagents/`: optional mechanical, exploration and review briefs.
- `tasks/`: gitignored current working state for long tasks.

One primary agent owns a feature. Helpers receive bounded tasks, explicit files
and return compact results. Concurrent writers may need isolated worktrees.

Keep one current task plan with objective, scope, progress, decisions and
validation gaps; replace stale state. Task notes are not architecture docs.
Current specifications live behind [docs/index.md](../docs/index.md).

Codex uses hierarchical AGENTS; Cursor points to the same source. Current Claude
Code supports AGENTS subject to client version, configuration and existing CLAUDE
files. Confirm loaded instructions in the client when needed; do not duplicate
rules or modify user settings automatically.
