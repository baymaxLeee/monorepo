# Project Monorepo — Multi-agent, Microservices, Micro-frontends

Single source of truth for ALL coding agents (Claude Code, Codex, Cursor, ...).
We use ONLY `AGENTS.md` files — no `CLAUDE.md`, no `.cursorrules`.

## Layout

```
apps/frontend/   pnpm + Rspack, micro-frontends (platform host + mfe-* remotes)
apps/backend/    uv + go.work, microservices (services/* + libs/* kernel)
schemas/        cross-stack & cross-service contracts (OpenAPI + Proto + Events)
infra/          K8s manifests, Dockerfiles, deployment
.agents/        multi-agent infrastructure (playbooks, sub-agents, scope rails)
docs/           ADR, architecture, conventions
```

## Multi-agent philosophy

The most efficient pattern for feature work is **ONE fullstack agent, one
context window, both stacks**. Do NOT dispatch separate "frontend agent" and
"backend agent" for the same feature — sub-agents have independent context
windows; you would lose every cross-stack decision you just made.

Sub-agents (defined in `.agents/subagents/`) are reserved for THREE cases:
1. **Context-free grunt work** — codegen, mass rename, mechanical migration
2. **Fresh-eyes review** — let a sub-agent audit your diff without bias
3. **Read-only exploration** — let a sub-agent dig through code and return
   a compact summary, keeping your main context lean

Switching between frontend and backend is done by `cd`, not by handing off.

For the full feature workflow, see `.agents/playbooks/full-stack-feature.md`.

## How to work in this repo

### Single-feature task (you alone — the default)
- Frontend-only: `cd apps/frontend` then read its `AGENTS.md`
- Backend-only:  `cd apps/backend` then read its `AGENTS.md`
- Cross-stack:   work from root; use `just sync` to bridge

### When in doubt about scope
Read `.agents/scopes/default.yaml` — it tells you which zones are free /
caution / forbidden for unprompted edits.

## Top-level commands (run from root)

| Command | What it does |
|---|---|
| `just up` | Docker (Postgres, Redis) + ensure DBs + dev schema (`migrate-dev.sh`) |
| `just down` | Stop local infra |
| `just install` | Install ALL deps (mise + pnpm + uv + go; copies `.env` from examples) |
| `just dev` | Start full demo stack (api-gateway + admin svc + platform + admin MFE) |
| `just sync` | Backend → OpenAPI → frontend TS client regen |
| `just fmt` | Format both stacks (auto-run after edits, no need to ask) |
| `just lint` | Lint both stacks |
| `just test` | Test both stacks |
| `just status` | Git + service health overview |

## Universal hard rules

### Boundaries (NEVER cross these)
- `apps/backend/services/<a>` MUST NOT import from `services/<b>` — use
  `libs/transport/` clients (gRPC/HTTP) or events.
- `apps/frontend/apps/<a>` MUST NOT import from `apps/<b>` — use
  `packages/runtime/` event bus.
- Frontend ↔ Backend coupling goes through `schemas/` ONLY (generated clients).
- `libs/` MUST stay kernel-only: errors, logging, transport, observability,
  auth, audit. **NEVER** add domain models to `libs/`.

### Forbidden zones for unprompted edits
- `**/generated/**` — codegen output
- `apps/backend/services/*/migrations/versions/**` — DB migrations
- `**/.env*` — secrets
- `.worktrees/**`, `.agents/tasks/*/` (except `_template/`)

### Required reads before editing
| Task | Read first |
|---|---|
| New backend route | `apps/backend/services/<svc>/AGENTS.md` + `docs/开发规范/` |
| New micro-frontend | `apps/frontend/AGENTS.md` + `docs/微前端/index.md` |
| New microservice | `docs/微服务/index.md` + `.agents/playbooks/new-microservice.md` |
| Cross-service refactor | `.agents/playbooks/cross-service-refactor.md` |

### Definition of done (every change)
1. `just fmt` (auto-run, do not ask)
2. `just lint` scoped to affected area
3. `just test` scoped to affected area
4. If cross-stack: `just sync` and verify both sides build
5. If new behavior: add/update ADR in `docs/ADR/NNNN-<slug>.md`
6. Update relevant `docs/<domain>/index.md` if conventions changed

## Worktree policy

Worktrees are an **escape hatch**, not the default. Use them ONLY when:
- Two independent agent **processes** run simultaneously (e.g. two terminals)
- A background long-running refactor must not block local work
- A/B experimenting with two implementation paths

For in-context multi-agent dispatch (one orchestrator → sub-agents via Task
tool), worktrees are NOT needed because sub-agents execute sequentially within
one process. The `scripts/worktree.sh` helper exists only for the cases above.

## Conventions

- Commits: Conventional Commits with service/mfe scope
  - `feat(bot): add publishing flow`
  - `fix(mfe-scene): correct pagination`
  - `chore(schema): regen clients`
- Branches: `feat/<task-id>-<slug>` or `agent/<task-id>/<subagent>`
- PRs: link to ADR if architectural

## When stuck

1. Re-read this file
2. Read the closest sub-`AGENTS.md` going down the tree
3. Read the relevant playbook in `.agents/playbooks/`
4. Search recent commits in same area for precedent
5. Ask user
